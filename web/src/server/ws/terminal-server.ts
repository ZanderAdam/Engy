import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AppState } from '../trpc/context';
import type { TerminalSpawnCmd, TerminalReconnectCmd, TerminalErrorEvent, TerminalSyncEvent } from '@engy/common';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { dispatchContainerUp } from './server';

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
): Promise<boolean> {
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

  if (!sessionId || !workingDir) {
    ws.close(1008, 'Missing sessionId or workingDir');
    return;
  }

  // Reconnect detection: only check persisted metadata (set after successful spawn).
  // Using terminalSessions for detection would false-positive on React Strict Mode
  // double-mount where the first connection's async spawn hasn't completed yet.
  const oldWs = state.terminalSessions.get(sessionId);
  if (oldWs && oldWs.readyState === oldWs.OPEN) {
    oldWs.close(1001, 'Replaced by new connection');
  }
  const isReconnect = state.terminalSessionMeta.has(sessionId);
  const short = sessionId.slice(0, 8);
  console.log(
    `[terminal] connection sid=${short} isReconnect=${isReconnect} daemon=${state.terminalDaemon != null}`,
  );
  state.terminalSessions.set(sessionId, ws);

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
        state.terminalSessionMeta.delete(sid);
        state.terminalSessions.delete(sid);
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
    // Only clear the WS reference — keep terminalSessionMeta for session restoration
    if (state.terminalSessions.get(sessionId) === ws) {
      state.terminalSessions.delete(sessionId);
    }
  });

  if (isReconnect) {
    const daemon = state.terminalDaemon;
    if (daemon && daemon.readyState === daemon.OPEN) {
      console.log(`[terminal] sending reconnect to daemon for sid=${short}`);
      daemon.send(JSON.stringify({ t: 'reconnect', sessionId } satisfies TerminalReconnectCmd));
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
      const ok = await maybeStartContainer(ws, sessionId, workspaceSlug, spawnCmd, state);
      if (!ok) return;
    }

    // After potential await (container startup), check if this connection was replaced
    // (React Strict Mode double-mount or rapid reconnect). Skip spawn to avoid duplicate PTYs.
    if (state.terminalSessions.get(sessionId) !== ws) {
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
        scopeType, scopeLabel, workingDir, command, groupKey, workspaceSlug, cols, rows,
      });
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
              const browserWs = state.terminalSessions.get(sessionId);
              if (browserWs && browserWs.readyState === browserWs.OPEN) {
                // Browser is still connected — respawn the session transparently
                console.log(`[terminal-relay] Stale session ${sessionId} (${meta.scopeLabel}) — respawning on daemon`);
                ws.send(
                  JSON.stringify({
                    t: 'spawn',
                    sessionId,
                    workingDir: meta.workingDir,
                    command: meta.command,
                    cols: meta.cols,
                    rows: meta.rows,
                    scopeType: meta.scopeType,
                    scopeLabel: meta.scopeLabel,
                  } satisfies TerminalSpawnCmd),
                );
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

      const browserWs = state.terminalSessions.get(sessionId);

      // Log non-output messages (output 'o' is too noisy)
      if (!str.startsWith('{"t":"o"')) {
        console.log(
          `[terminal-relay] Daemon→Browser: ${str.slice(0, 150)} | browserWs=${browserWs ? 'found' : 'NOT FOUND'}`,
        );
      }

      if (browserWs) sendRaw(browserWs, str);

      // Exit messages start with {"t":"exit" — no data field to confuse
      const isExit = str.startsWith('{"t":"exit"');
      if (isExit) {
        console.log(`[terminal-relay] Exit for session ${sessionId}, cleaning up meta and WS`);
        state.terminalSessions.delete(sessionId);
        state.terminalSessionMeta.delete(sessionId);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(
        `[terminal-relay] Daemon disconnected: code=${code} reason=${reason?.toString() ?? ''}`,
      );
      if (state.terminalDaemon === ws) {
        console.log(`[terminal] daemon relay disconnected — clearing ${state.terminalSessionMeta.size} session meta entries`);
        state.terminalDaemon = null;
        // All daemon-side PTY sessions are dead — clear stale metadata so future
        // connections spawn fresh instead of falsely detecting reconnects.
        // terminalSessions (browser WSs) are left intact so browsers can still receive
        // output/errors; they'll spawn fresh on next connect since meta is gone.
        state.terminalSessionMeta.clear();
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
