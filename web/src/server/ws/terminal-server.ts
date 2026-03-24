import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AppState } from '../trpc/context';
import type { TerminalSpawnCmd, TerminalReconnectCmd, TerminalErrorEvent, TerminalSyncEvent } from '@engy/common';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { dispatchContainerUp } from './server';
import { broadcastTerminalSessionsChange } from './broadcast';

function parseQueryParams(url: string): URLSearchParams {
  const idx = url.indexOf('?');
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
}

// Lightweight sessionId extraction — avoids full JSON.parse on the hot path.
// Only searches the message prefix (before the data payload) to prevent PTY output
// from being matched. sessionId is always a UUID (36 chars) placed before the 'd' field.
const SESSION_ID_RE = /"sessionId"\s*:\s*"([^"]+)"/;

function extractSessionId(raw: string): string | null {
  // Only search prefix before any data payload — sessionId is always before 'd'
  const searchWindow = raw.slice(0, 120);
  const m = SESSION_ID_RE.exec(searchWindow);
  return m ? m[1] : null;
}

function sendTerminalOutput(ws: WebSocket, sessionId: string, text: string): void {
  sendRaw(ws, JSON.stringify({ t: 'o', sessionId, d: text }));
}

function addBrowserWs(state: AppState, sessionId: string, ws: WebSocket): void {
  let wsSet = state.terminalSessions.get(sessionId);
  if (!wsSet) {
    wsSet = new Set();
    state.terminalSessions.set(sessionId, wsSet);
  }
  wsSet.add(ws);
}

function removeBrowserWs(state: AppState, sessionId: string, ws: WebSocket): void {
  const wsSet = state.terminalSessions.get(sessionId);
  if (!wsSet) return;
  wsSet.delete(ws);
  if (wsSet.size === 0) {
    state.terminalSessions.delete(sessionId);
  }
}

function hasAnyOpenBrowser(state: AppState, sessionId: string): boolean {
  const wsSet = state.terminalSessions.get(sessionId);
  if (!wsSet) return false;
  for (const ws of wsSet) {
    if (ws.readyState === ws.OPEN) return true;
  }
  return false;
}

function broadcastToSession(state: AppState, sessionId: string, data: string): void {
  const wsSet = state.terminalSessions.get(sessionId);
  if (!wsSet) return;
  for (const ws of wsSet) {
    sendRaw(ws, data);
  }
}

function sendTerminalError(ws: WebSocket, message: string): void {
  sendRaw(ws, JSON.stringify({ t: 'error', message } satisfies TerminalErrorEvent));
}

/**
 * If the workspace has containerEnabled, start the container and stream progress.
 * Sets spawnCmd.containerWorkspaceFolder on success.
 * Returns false if container start failed and the connection should be aborted.
 */
async function maybeStartContainer(
  ws: WebSocket,
  sessionId: string,
  workspaceSlug: string,
  spawnCmd: TerminalSpawnCmd,
  state: AppState,
  containerMode?: string,
): Promise<boolean> {
  // Explicit host mode — skip container entirely
  if (containerMode === 'host') return true;

  let workspace;
  try {
    const db = getDb();
    workspace = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  } catch {
    return true; // DB unavailable — spawn without container
  }

  if (!workspace?.containerEnabled || !workspace.docsDir) return true;

  spawnCmd.containerWorkspaceFolder = workspace.docsDir;
  sendTerminalOutput(ws, sessionId, 'Starting dev container...\r\n');

  const requestId = randomUUID();
  state.containerProgressListeners.set(requestId, (line) => {
    sendTerminalOutput(ws, sessionId, `\x1b[2m${line}\x1b[0m\r\n`);
  });

  try {
    await dispatchContainerUp(
      state,
      workspace.docsDir,
      Array.isArray(workspace.repos) ? workspace.repos : [],
      workspace.containerConfig ?? undefined,
      requestId,
    );
    sendTerminalOutput(ws, sessionId, '\x1b[32mContainer ready.\x1b[0m\r\n');
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    sendTerminalOutput(ws, sessionId, `\x1b[31mContainer start failed: ${errMsg}\x1b[0m\r\n`);
    ws.close(1011, 'Container start failed');
    return false;
  } finally {
    state.containerProgressListeners.delete(requestId);
  }
}

async function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
  state: AppState,
): Promise<void> {
  const params = parseQueryParams(req.url ?? '');
  const sessionId = params.get('sessionId');
  const workingDir = params.get('workingDir');
  const command = params.get('command') ?? undefined;
  const cols = parseInt(params.get('cols') ?? '80', 10);
  const rows = parseInt(params.get('rows') ?? '24', 10);
  const scopeType = params.get('scopeType') ?? 'workspace';
  const scopeLabel = params.get('scopeLabel') ?? '';
  const groupKey = params.get('groupKey') ?? undefined;
  const workspaceSlug = params.get('workspaceSlug') ?? '';
  const containerMode = params.get('containerMode') ?? undefined;

  if (!sessionId || !workingDir) {
    ws.close(1008, 'Missing sessionId or workingDir');
    return;
  }

  // Reconnect detection: only check persisted metadata (set after successful spawn).
  // Using terminalSessions for detection would false-positive on React Strict Mode
  // double-mount where the first connection's async spawn hasn't completed yet.
  const isReconnect = state.terminalSessionMeta.has(sessionId);
  const short = sessionId.slice(0, 8);
  const existingCount = state.terminalSessions.get(sessionId)?.size ?? 0;
  console.log(
    `[terminal] connection sid=${short} isReconnect=${isReconnect} existingBrowsers=${existingCount} daemon=${state.terminalDaemon != null}`,
  );
  addBrowserWs(state, sessionId, ws);

  // Update existing meta's groupKey if needed (reconnect case only)
  const existingMeta = state.terminalSessionMeta.get(sessionId);
  if (existingMeta && !existingMeta.groupKey && groupKey) {
    existingMeta.groupKey = groupKey;
  }

  // Register handlers early so input is forwarded even during container startup
  ws.on('message', (raw: Buffer | string) => {
    const str = typeof raw === 'string' ? raw : raw.toString('utf-8');

    // Intercept kill messages to clean up session metadata (rare path)
    if (str.startsWith('{"t":"kill"')) {
      const sid = extractSessionId(str);
      if (sid) {
        console.log(`[terminal] Kill intercepted for session ${sid}`);
        const killedMeta = state.terminalSessionMeta.get(sid);
        state.terminalSessionMeta.delete(sid);
        // Close all attached browsers and remove the session
        const wsSet = state.terminalSessions.get(sid);
        if (wsSet) {
          for (const bws of wsSet) {
            if (bws !== ws && bws.readyState === bws.OPEN) bws.close(1001, 'Session killed');
          }
        }
        state.terminalSessions.delete(sid);
        broadcastTerminalSessionsChange('destroyed', sid, killedMeta?.groupKey);
      }
    }

    const td = state.terminalDaemon;
    if (td && td.readyState === td.OPEN) {
      td.send(str);
    } else if (!str.startsWith('{"t":"i"')) {
      // Log non-input messages that can't be forwarded (input is too noisy)
      console.warn(`[terminal] Cannot forward to daemon (not connected): ${str.slice(0, 100)}`);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(
      `[terminal] Browser WS closed for sid=${short}: code=${code} reason=${reason?.toString() ?? ''}`,
    );
    // Remove this browser from the session's WS set — keep terminalSessionMeta for restoration
    removeBrowserWs(state, sessionId, ws);
    // Only clear pending reconnect if this WS is the one awaiting the buffer
    if (state.pendingReconnects.get(sessionId) === ws) {
      state.pendingReconnects.delete(sessionId);
    }
    const meta = state.terminalSessionMeta.get(sessionId);
    broadcastTerminalSessionsChange('detached', sessionId, meta?.groupKey);
  });

  if (isReconnect) {
    const daemon = state.terminalDaemon;
    if (daemon && daemon.readyState === daemon.OPEN) {
      console.log(`[terminal] sending reconnect to daemon for sid=${short}`);
      // Track this WS so the reconnected buffer is replayed only to it, not all browsers
      state.pendingReconnects.set(sessionId, ws);
      daemon.send(JSON.stringify({ t: 'reconnect', sessionId } satisfies TerminalReconnectCmd));
      broadcastTerminalSessionsChange('attached', sessionId, existingMeta?.groupKey);
    } else {
      console.log(`[terminal] reconnect path but no daemon — clearing meta sid=${short}`);
      state.terminalSessionMeta.delete(sessionId);
      sendTerminalError(ws, 'No daemon connected');
    }
  } else {
    const spawnCmd: TerminalSpawnCmd = {
      t: 'spawn',
      sessionId,
      workingDir,
      command,
      cols,
      rows,
      scopeType,
      scopeLabel,
    };

    if (workspaceSlug) {
      const ok = await maybeStartContainer(ws, sessionId, workspaceSlug, spawnCmd, state, containerMode);
      if (!ok) return;
    }

    // After potential await (container startup), check if this connection was removed
    // (React Strict Mode double-mount or rapid reconnect). Skip spawn to avoid duplicate PTYs.
    const currentSet = state.terminalSessions.get(sessionId);
    if (!currentSet || !currentSet.has(ws)) {
      console.log(`[terminal] spawn abandoned — connection replaced for sid=${short}`);
      return;
    }

    // Read daemon AFTER await — it may have reconnected during container startup
    const daemon = state.terminalDaemon;
    if (daemon && daemon.readyState === daemon.OPEN) {
      console.log(`[terminal] sending spawn to daemon for sid=${short}`);
      daemon.send(JSON.stringify(spawnCmd));
      // Only persist meta after spawn is sent — prevents false reconnects
      // from concurrent connections (React Strict Mode double-mount)
      state.terminalSessionMeta.set(sessionId, {
        scopeType, scopeLabel, workingDir, command, groupKey, workspaceSlug, containerMode, cols, rows,
      });
      broadcastTerminalSessionsChange('created', sessionId, groupKey);
    } else {
      console.log(`[terminal] spawn path but no daemon for sid=${short}`);
      sendTerminalError(ws, 'No daemon connected');
    }
  }
}

/**
 * Browser → Server WebSocket for terminal connections.
 * Browser sends compact messages ({ t: 'i', sessionId, d } / { t: 'resize', ... }).
 * These are forwarded RAW to the daemon terminal relay — zero parse on the hot path.
 */
export function createTerminalWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleTerminalConnection(ws, req, state).catch((err: unknown) => {
      console.error('Terminal connection error:', err);
      if (ws.readyState === ws.OPEN) ws.close(1011, 'Internal error');
    });
  });

  return wss;
}

/**
 * Daemon → Server terminal relay WebSocket.
 * Daemon sends compact messages ({ t: 'o', sessionId, d } / { t: 'exit', ... } / { t: 'reconnected', ... }).
 * Server extracts sessionId via regex and forwards raw to the correct browser WS.
 */
export function createTerminalRelayWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    console.log(`[terminal-relay] Daemon connected to terminal relay (meta count: ${state.terminalSessionMeta.size})`);
    state.terminalDaemon = ws;

    // Hot path: forward daemon terminal output raw to browser
    ws.on('message', (raw: Buffer | string) => {
      const str = typeof raw === 'string' ? raw : raw.toString('utf-8');

      // Handle sync message — daemon announces its known sessions
      if (str.startsWith('{"t":"sync"')) {
        try {
          const sync = JSON.parse(str) as TerminalSyncEvent;
          const daemonSessionIds = new Set(sync.sessionIds);
          console.log(
            `[terminal-relay] Daemon sync: ${daemonSessionIds.size} alive sessions. Server has ${state.terminalSessionMeta.size} meta entries.`,
          );

          // Respawn or clean up sessions the daemon no longer has
          for (const [sessionId, meta] of state.terminalSessionMeta) {
            if (!daemonSessionIds.has(sessionId)) {
              if (hasAnyOpenBrowser(state, sessionId)) {
                // Browser is still connected — respawn the session transparently
                console.log(`[terminal-relay] Stale session ${sessionId} (${meta.scopeLabel}) — respawning on daemon`);
                const spawnCmd: TerminalSpawnCmd = {
                  t: 'spawn',
                  sessionId,
                  workingDir: meta.workingDir,
                  command: meta.command,
                  cols: meta.cols,
                  rows: meta.rows,
                  scopeType: meta.scopeType,
                  scopeLabel: meta.scopeLabel,
                };
                // Restore containerWorkspaceFolder for container-mode sessions
                if (meta.containerMode === 'container' && meta.workspaceSlug) {
                  try {
                    const db = getDb();
                    const workspace = db.select().from(workspaces)
                      .where(eq(workspaces.slug, meta.workspaceSlug)).get();
                    if (workspace?.containerEnabled && workspace.docsDir) {
                      spawnCmd.containerWorkspaceFolder = workspace.docsDir;
                    }
                  } catch {
                    // DB unavailable — spawn on host as fallback
                  }
                }
                ws.send(JSON.stringify(spawnCmd));
                broadcastTerminalSessionsChange('created', sessionId, meta.groupKey);
              } else {
                // No browser connected — just clean up
                console.log(`[terminal-relay] Stale session ${sessionId} (${meta.scopeLabel}) — no browser, cleaning up`);
                state.terminalSessions.delete(sessionId);
                state.terminalSessionMeta.delete(sessionId);
              }
            }
          }
        } catch {
          console.warn('[terminal-relay] Failed to parse sync message');
        }
        return;
      }

      const sessionId = extractSessionId(str);
      if (!sessionId) return;

      const wsSet = state.terminalSessions.get(sessionId);

      // Log non-output messages (output 'o' is too noisy)
      if (!str.startsWith('{"t":"o"')) {
        console.log(
          `[terminal-relay] Daemon→Browser: ${str.slice(0, 150)} | browsers=${wsSet?.size ?? 0}`,
        );
      }

      // Reconnected buffer replayed only to the browser that requested it
      if (str.startsWith('{"t":"reconnected"')) {
        const reconnectWs = state.pendingReconnects.get(sessionId);
        state.pendingReconnects.delete(sessionId);
        if (reconnectWs) {
          sendRaw(reconnectWs, str);
        } else {
          console.warn(`[terminal-relay] Reconnected buffer for ${sessionId} dropped — no pending browser`);
        }
      } else if (wsSet) {
        broadcastToSession(state, sessionId, str);
      }

      // Exit messages start with {"t":"exit" — no data field to confuse
      const isExit = str.startsWith('{"t":"exit"');
      if (isExit) {
        console.log(`[terminal-relay] Exit for session ${sessionId}, cleaning up meta and WS`);
        const exitMeta = state.terminalSessionMeta.get(sessionId);
        state.terminalSessions.delete(sessionId);
        state.terminalSessionMeta.delete(sessionId);
        broadcastTerminalSessionsChange('destroyed', sessionId, exitMeta?.groupKey);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(
        `[terminal-relay] Daemon disconnected: code=${code} reason=${reason?.toString() ?? ''}`,
      );
      if (state.terminalDaemon === ws) {
        console.log(`[terminal] daemon relay disconnected — retaining ${state.terminalSessionMeta.size} session meta entries for respawn`);
        state.terminalDaemon = null;
        // Keep terminalSessionMeta intact so the sync handler can respawn
        // sessions with active browsers when a new daemon connects.
        // The sync handler already cleans up entries with no active browser WS.
      }
    });
  });

  return wss;
}

function sendRaw(ws: WebSocket, data: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(data);
  }
}
