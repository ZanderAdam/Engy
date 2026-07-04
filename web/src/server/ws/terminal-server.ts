import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import type {
  TerminalSpawnCmd,
  TerminalResizeCmd,
  TerminalReconnectCmd,
  TerminalErrorEvent,
  TerminalSyncEvent,
  TerminalActivityEvent,
} from '@engy/common';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { dispatchContainerUp } from './server';
import { broadcastTerminalSessionsChange, broadcastTerminalActivityChange } from './broadcast';
import {
  persistTerminalSession,
  deletePersistedTerminalSession,
} from './terminal-session-store';
import {
  destroyTerminalSession,
  disconnectWorker,
  failWorkerDispatches,
  flushDispatchInbox,
  isTrackedWorker,
  recordWorkerOutput,
} from '../terminal-dispatch';
import { MCP_SESSION_PLACEHOLDER } from '@/lib/agent-types';

// How long a browser connect with no session metadata waits for the daemon's
// `{ t: 'sync' }` before classifying as spawn-vs-reconnect. Covers the
// post-server-restart window where browsers reconnect before the daemon relay
// has announced which sessions survived — classifying early would send a spawn
// that kills the surviving PTY. Generous enough for the daemon's reconnect
// backoff after a typical restart; on timeout the connect falls back to the
// pre-existing spawn/no-daemon behavior.
const DAEMON_SYNC_WAIT_MS = 10_000;

function waitForDaemonSync(state: AppState, timeoutMs: number): Promise<void> {
  if (state.daemonTerminalSessions.synced) return Promise.resolve();
  return new Promise((resolve) => {
    const waiter = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      state.daemonTerminalSessions.syncWaiters.delete(waiter);
      resolve();
    }, timeoutMs);
    state.daemonTerminalSessions.syncWaiters.add(waiter);
  });
}

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

  const isCoder = workspace.executionBackend === 'coder';
  const coderCfg = workspace.coderConfig as { workspace: string; repoBasePath: string } | null;

  if (isCoder && coderCfg?.workspace) {
    spawnCmd.coderWorkspace = coderCfg.workspace;
    // Derive server port for reverse forwarding
    spawnCmd.serverPort = parseInt(process.env.PORT ?? '3000', 10);
  } else {
    spawnCmd.containerWorkspaceFolder = workspace.docsDir;
  }

  const label = isCoder ? 'Coder workspace' : 'dev container';
  sendTerminalOutput(ws, sessionId, `Starting ${label}...\r\n`);

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
      isCoder ? 'coder' : 'devcontainer',
      coderCfg?.workspace,
      requestId,
    );
    sendTerminalOutput(ws, sessionId, `\x1b[32m${isCoder ? 'Workspace' : 'Container'} ready.\x1b[0m\r\n`);
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
  daemonSyncWaitMs: number,
): Promise<void> {
  const params = parseQueryParams(req.url ?? '');
  const sessionId = params.get('sessionId');
  const workingDir = params.get('workingDir');
  const command = params.get('command') ?? undefined;
  const agentType = params.get('agentType') ?? undefined;
  const cols = parseInt(params.get('cols') ?? '80', 10);
  const rows = parseInt(params.get('rows') ?? '24', 10);
  const scopeType = params.get('scopeType') ?? 'workspace';
  const scopeLabel = params.get('scopeLabel') ?? '';
  const groupKey = params.get('groupKey') ?? undefined;
  const workspaceSlug = params.get('workspaceSlug') ?? '';
  const containerMode = params.get('containerMode') ?? undefined;
  const taskIdRaw = params.get('taskId');
  const taskIdParsed = taskIdRaw ? parseInt(taskIdRaw, 10) : NaN;
  const taskId = Number.isInteger(taskIdParsed) && taskIdParsed > 0 ? taskIdParsed : undefined;
  const projectIdRaw = params.get('projectId');
  const projectIdParsed = projectIdRaw ? parseInt(projectIdRaw, 10) : NaN;
  const projectId =
    Number.isInteger(projectIdParsed) && projectIdParsed > 0 ? projectIdParsed : undefined;
  const projectSlug = params.get('projectSlug') ?? undefined;
  const worktreeBranch = params.get('worktreeBranch') ?? undefined;

  if (!sessionId || !workingDir) {
    ws.close(1008, 'Missing sessionId or workingDir');
    return;
  }

  // Swap the MCP session placeholder for the real sessionId, so the agent's
  // Engy MCP endpoint is /mcp/<sessionId> — its identity on every tool call.
  // Stored substituted in meta so respawns reuse the same endpoint.
  const resolvedCommand = command?.replaceAll(MCP_SESSION_PLACEHOLDER, sessionId);

  // Initial classification (log only): persisted metadata (set after successful
  // spawn) or an in-flight spawn for the same sessionId. Using terminalSessions
  // for detection would false-positive on React Strict Mode double-mount where
  // the first connection's async spawn hasn't completed yet. The authoritative
  // classification happens below, after waiting out any in-flight spawn.
  const isReconnect =
    state.terminalSessionMeta.has(sessionId) || state.spawningSessions.has(sessionId);
  const short = sessionId.slice(0, 8);
  const existingCount = state.terminalSessions.get(sessionId)?.size ?? 0;
  console.log(
    `[terminal] connection sid=${short} isReconnect=${isReconnect} daemonKnown=${state.daemonTerminalSessions.ids.has(sessionId)} existingBrowsers=${existingCount} daemon=${state.terminalDaemon != null}`,
  );
  addBrowserWs(state, sessionId, ws);

  // Update existing meta's groupKey if needed (reconnect case only)
  const existingMeta = state.terminalSessionMeta.get(sessionId);
  if (existingMeta && !existingMeta.groupKey && groupKey) {
    existingMeta.groupKey = groupKey;
    persistTerminalSession(sessionId, existingMeta);
  }

  // Register handlers early so input is forwarded even during container startup
  ws.on('message', (raw: Buffer | string) => {
    const str = typeof raw === 'string' ? raw : raw.toString('utf-8');

    // Intercept kill messages to clean up session metadata (rare path). The
    // sender ws is excluded from the exit-frame fan-out — it initiated the
    // kill and tears itself down client-side.
    if (str.startsWith('{"t":"kill"')) {
      const sid = extractSessionId(str);
      if (sid) {
        console.log(`[terminal] Kill intercepted for session ${sid}`);
        destroyTerminalSession(state, sid, { excludeWs: ws });
      }
    }

    // The user viewed/focused the terminal — clear its activity state here (so
    // badges update even if the daemon is down or its tracker has drifted) and
    // let the generic forward below deliver the ack to the daemon tracker too.
    if (str.startsWith('{"t":"ack"')) {
      const meta = state.terminalSessionMeta.get(sessionId);
      if (meta && meta.activityState && meta.activityState !== 'idle') {
        meta.activityState = 'idle';
        persistTerminalSession(sessionId, meta);
        if (meta.projectSlug) {
          broadcastTerminalActivityChange({
            sessionId,
            projectSlug: meta.projectSlug,
            state: 'idle',
          });
        }
      }
    }

    // The browser's resize guard assumes "last sent" === "PTY size". Track the
    // size on the meta so respawn and relay-reconnect re-assert the real size,
    // not the initial spawn size. Only the owning connection may update it.
    if (str.startsWith('{"t":"resize"')) {
      try {
        const resize = JSON.parse(str) as TerminalResizeCmd;
        const meta = state.terminalSessionMeta.get(sessionId);
        if (
          resize.sessionId === sessionId &&
          meta &&
          Number.isInteger(resize.cols) &&
          Number.isInteger(resize.rows)
        ) {
          meta.cols = resize.cols;
          meta.rows = resize.rows;
          persistTerminalSession(sessionId, meta);
        }
      } catch {
        console.warn('[terminal] Failed to parse resize message');
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
    // Remove this WS from the pending reconnect set if present
    const pendingSet = state.pendingReconnects.get(sessionId);
    if (pendingSet) {
      pendingSet.delete(ws);
      if (pendingSet.size === 0) {
        state.pendingReconnects.delete(sessionId);
      }
    }
    const meta = state.terminalSessionMeta.get(sessionId);
    broadcastTerminalSessionsChange('detached', sessionId, meta?.groupKey);
  });

  // The daemon's sync is the source of truth for which sessions survived a
  // server or relay restart. Hold classification until it arrives (or times
  // out) when we cannot trust local state: a no-meta connect would otherwise
  // spawn over a surviving PTY, and a meta entry restored from the DB at boot
  // must be validated against a live daemon before a reconnect is issued for
  // it. Live sessions with in-memory meta skip the wait — for those the old
  // immediate no-daemon handling applies.
  const needsSyncValidation =
    !state.terminalSessionMeta.has(sessionId) || state.restoredTerminalSessions.has(sessionId);
  if (needsSyncValidation && !state.daemonTerminalSessions.synced) {
    await waitForDaemonSync(state, daemonSyncWaitMs);
    const setAfterSyncWait = state.terminalSessions.get(sessionId);
    if (!setAfterSyncWait || !setAfterSyncWait.has(ws)) {
      console.log(`[terminal] connect abandoned while awaiting daemon sync for sid=${short}`);
      return;
    }
  }

  // Wait out an in-flight spawn before classifying — the daemon only knows the
  // session once the originating spawn has been sent. Loop: a waiter that falls
  // through to a fresh spawn installs a new gate synchronously, so later waiters
  // re-wait and serialize instead of double-spawning.
  let inflightSpawn = state.spawningSessions.get(sessionId);
  while (inflightSpawn) {
    await inflightSpawn;
    const currentSet = state.terminalSessions.get(sessionId);
    if (!currentSet || !currentSet.has(ws)) {
      console.log(`[terminal] connect abandoned while awaiting spawn for sid=${short}`);
      return;
    }
    inflightSpawn = state.spawningSessions.get(sessionId);
  }

  // command is stored resolved (MCP session placeholder → real sessionId) so
  // the per-session endpoint in the meta matches what the PTY actually runs.
  const metaFromParams: TerminalSessionMeta = {
    scopeType,
    scopeLabel,
    workingDir,
    command: resolvedCommand,
    agentType,
    groupKey,
    workspaceSlug,
    containerMode,
    taskId,
    projectId,
    projectSlug,
    worktreeBranch,
    cols,
    rows,
  };

  // Adopt a daemon-surviving session the server has no meta for (server
  // restart wiped it): rebuild the meta from the connect params so the
  // classification below routes through reconnect instead of respawning
  // over the live PTY. Requires `synced` so a stale alive set from a previous
  // relay connection is never used as adoption evidence.
  if (
    !state.terminalSessionMeta.has(sessionId) &&
    state.daemonTerminalSessions.synced &&
    state.daemonTerminalSessions.ids.has(sessionId)
  ) {
    console.log(`[terminal] adopting daemon-surviving session sid=${short}`);
    state.terminalSessionMeta.set(sessionId, metaFromParams);
    persistTerminalSession(sessionId, metaFromParams);
  }

  // Classify after the wait: meta present → the spawn succeeded, join via
  // reconnect. Meta absent → the spawn was abandoned or failed; spawn fresh.
  if (state.terminalSessionMeta.has(sessionId)) {
    const daemon = state.terminalDaemon;
    if (daemon && daemon.readyState === daemon.OPEN) {
      console.log(`[terminal] sending reconnect to daemon for sid=${short}`);
      // Track this WS so the reconnected buffer is replayed only to it, not all browsers
      let pendingSet = state.pendingReconnects.get(sessionId);
      if (!pendingSet) {
        pendingSet = new Set();
        state.pendingReconnects.set(sessionId, pendingSet);
      }
      pendingSet.add(ws);
      daemon.send(JSON.stringify({ t: 'reconnect', sessionId } satisfies TerminalReconnectCmd));
      broadcastTerminalSessionsChange(
        'attached',
        sessionId,
        state.terminalSessionMeta.get(sessionId)?.groupKey,
      );
    } else {
      // Retain meta so the sync handler can respawn the session when the daemon reconnects.
      console.log(`[terminal] reconnect path but no daemon — keeping meta sid=${short}`);
      sendTerminalError(ws, 'No daemon connected');
    }
  } else {
    // Gate the spawn so concurrent connects for the same sessionId wait instead of
    // spawning a duplicate PTY. Installed synchronously (before any await) and
    // cleared on every exit path, including thrown errors.
    let resolveSpawn!: () => void;
    state.spawningSessions.set(
      sessionId,
      new Promise<void>((resolve) => {
        resolveSpawn = resolve;
      }),
    );

    try {
      const spawnCmd: TerminalSpawnCmd = {
        t: 'spawn',
        sessionId,
        workingDir,
        command: resolvedCommand,
        cols,
        rows,
        scopeType,
        scopeLabel,
      };

      if (workspaceSlug) {
        const ok = await maybeStartContainer(
          ws,
          sessionId,
          workspaceSlug,
          spawnCmd,
          state,
          containerMode,
        );
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
        state.daemonTerminalSessions.ids.add(sessionId);
        // Only persist meta after spawn is sent — prevents false reconnects
        // from concurrent connections (React Strict Mode double-mount)
        state.terminalSessionMeta.set(sessionId, metaFromParams);
        persistTerminalSession(sessionId, metaFromParams);
        broadcastTerminalSessionsChange('created', sessionId, groupKey);
      } else {
        console.log(`[terminal] spawn path but no daemon for sid=${short}`);
        sendTerminalError(ws, 'No daemon connected');
      }
    } finally {
      state.spawningSessions.delete(sessionId);
      resolveSpawn();
    }
  }
}

/**
 * Browser → Server WebSocket for terminal connections.
 * Browser sends compact messages ({ t: 'i', sessionId, d } / { t: 'resize', ... }).
 * These are forwarded RAW to the daemon terminal relay — zero parse on the hot path.
 */
export function createTerminalWebSocketServer(
  state: AppState,
  opts?: { daemonSyncWaitMs?: number },
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const daemonSyncWaitMs = opts?.daemonSyncWaitMs ?? DAEMON_SYNC_WAIT_MS;

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleTerminalConnection(ws, req, state, daemonSyncWaitMs).catch((err: unknown) => {
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

          // Record the daemon's alive set — this is what lets a restarted
          // server (empty meta) classify browser reconnects as existing
          // sessions instead of respawning over live PTYs.
          state.daemonTerminalSessions.ids = daemonSessionIds;
          state.daemonTerminalSessions.synced = true;

          // Heal activity states dropped while the relay was down — act
          // messages sent during the outage never arrived, so the stored
          // state can be arbitrarily stale until the next transition.
          for (const { sessionId, state: actState } of sync.activity ?? []) {
            const meta = state.terminalSessionMeta.get(sessionId);
            if (!meta || (meta.activityState ?? 'idle') === actState) continue;
            meta.activityState = actState;
            persistTerminalSession(sessionId, meta);
            if (meta.projectSlug) {
              broadcastTerminalActivityChange({
                sessionId,
                projectSlug: meta.projectSlug,
                state: actState,
              });
            }
          }

          // Respawn or clean up sessions the daemon no longer has
          for (const [sessionId, meta] of state.terminalSessionMeta) {
            if (daemonSessionIds.has(sessionId)) {
              // Session survived on the daemon, but resizes sent while the relay
              // was down were dropped — the browser's guard already recorded them
              // as sent, so it will never resend. Re-assert the last known size.
              if (hasAnyOpenBrowser(state, sessionId)) {
                ws.send(
                  JSON.stringify({
                    t: 'resize',
                    sessionId,
                    cols: meta.cols,
                    rows: meta.rows,
                  } satisfies TerminalResizeCmd),
                );
              }
            } else {
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
                // Restore container/coder config for isolated sessions
                if (meta.containerMode === 'container' && meta.workspaceSlug) {
                  try {
                    const db = getDb();
                    const workspace = db.select().from(workspaces)
                      .where(eq(workspaces.slug, meta.workspaceSlug)).get();
                    if (workspace?.containerEnabled && workspace.docsDir) {
                      if (workspace.executionBackend === 'coder') {
                        const coderCfg = workspace.coderConfig as { workspace: string } | null;
                        if (coderCfg?.workspace) {
                          spawnCmd.coderWorkspace = coderCfg.workspace;
                          spawnCmd.serverPort = parseInt(process.env.PORT ?? '3000', 10);
                        }
                      } else {
                        spawnCmd.containerWorkspaceFolder = workspace.docsDir;
                      }
                    }
                  } catch {
                    // DB unavailable — spawn on host as fallback
                  }
                }
                ws.send(JSON.stringify(spawnCmd));
                daemonSessionIds.add(sessionId);
                broadcastTerminalSessionsChange('created', sessionId, meta.groupKey);
              } else {
                // No browser connected — full teardown. Agent-spawned workers
                // always land here (they never have a browser), so this must
                // fail dispatches, drop the worker entry, and clear activity
                // badges instead of leaking phantom state.
                console.log(`[terminal-relay] Stale session ${sessionId} (${meta.scopeLabel}) — no browser, cleaning up`);
                destroyTerminalSession(state, sessionId);
              }
            }
          }

          // DB-restored entries are now validated: alive ones were kept above,
          // dead ones purged. Later connects can trust in-memory meta again.
          state.restoredTerminalSessions.clear();

          // Release browser connects that arrived before this sync — they can
          // now classify against the recorded alive set.
          for (const waiter of state.daemonTerminalSessions.syncWaiters) waiter();
          state.daemonTerminalSessions.syncWaiters.clear();
        } catch {
          console.warn('[terminal-relay] Failed to parse sync message');
        }
        return;
      }

      // Activity transitions: persist on the session meta (so badges work for
      // unmounted terminals) and broadcast a per-project delta. Not forwarded to
      // the browser terminal sockets — they only consume raw PTY output.
      if (str.startsWith('{"t":"act"')) {
        try {
          const act = JSON.parse(str) as TerminalActivityEvent;
          const meta = state.terminalSessionMeta.get(act.sessionId);
          if (meta) {
            meta.activityState = act.state;
            persistTerminalSession(act.sessionId, meta);
            broadcastTerminalActivityChange({
              sessionId: act.sessionId,
              projectSlug: meta.projectSlug,
              state: act.state,
            });
            // Idle-gated dispatch delivery: a worker that just finished its
            // turn receives the next queued cross-terminal dispatch.
            if (act.state === 'idle' || act.state === 'done') {
              flushDispatchInbox(state, act.sessionId);
            }
          }
        } catch {
          console.warn('[terminal-relay] Failed to parse act message');
        }
        return;
      }

      const sessionId = extractSessionId(str);
      if (!sessionId) return;

      // Bounded output tail for connected dispatch workers (terminal_status).
      // Parse only for tracked sessions — the hot path stays zero-parse.
      if (str.startsWith('{"t":"o"') && isTrackedWorker(state, sessionId)) {
        try {
          const frame = JSON.parse(str) as { d?: string };
          if (typeof frame.d === 'string') recordWorkerOutput(state, sessionId, frame.d);
        } catch {
          // Malformed frame — skip tail recording, forwarding continues below
        }
      }

      const wsSet = state.terminalSessions.get(sessionId);

      // Log non-output messages (output 'o' is too noisy)
      if (!str.startsWith('{"t":"o"')) {
        console.log(
          `[terminal-relay] Daemon→Browser: ${str.slice(0, 150)} | browsers=${wsSet?.size ?? 0}`,
        );
      }

      // Reconnected buffer replayed only to the browsers that requested it, not all attached browsers
      if (str.startsWith('{"t":"reconnected"')) {
        const pendingSet = state.pendingReconnects.get(sessionId);
        state.pendingReconnects.delete(sessionId);
        if (pendingSet && pendingSet.size > 0) {
          for (const pendingWs of pendingSet) {
            sendRaw(pendingWs, str);
          }
        } else {
          console.warn(`[terminal-relay] Reconnected buffer for ${sessionId} dropped — no pending browser`);
        }
      } else if (wsSet) {
        broadcastToSession(state, sessionId, str);
      }

      // Exit messages start with {"t":"exit" — no data field to confuse.
      const isExit = str.startsWith('{"t":"exit"');
      if (isExit) {
        // Whatever the server-side state, the daemon no longer has this PTY —
        // drop it from the alive set (and the SQLite mirror) unconditionally
        // so a later connect can't adopt a dead session.
        state.daemonTerminalSessions.ids.delete(sessionId);
        deletePersistedTerminalSession(sessionId);
      }
      // Skip the teardown when the session is already torn down (kill /
      // terminal_close ran destroyTerminalSession before the daemon's exit
      // arrived) — re-running would emit a second 'destroyed' broadcast with
      // no groupKey context.
      if (isExit && (state.terminalSessionMeta.has(sessionId) || state.terminalSessions.has(sessionId))) {
        console.log(`[terminal-relay] Exit for session ${sessionId}, cleaning up meta and WS`);
        const exitMeta = state.terminalSessionMeta.get(sessionId);
        state.terminalSessions.delete(sessionId);
        state.terminalSessionMeta.delete(sessionId);
        failWorkerDispatches(state, sessionId, 'Worker terminal exited');
        disconnectWorker(state, sessionId);
        broadcastTerminalSessionsChange('destroyed', sessionId, exitMeta?.groupKey);
        if (exitMeta?.projectSlug) {
          broadcastTerminalActivityChange({ sessionId, projectSlug: exitMeta.projectSlug, removed: true });
        }
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
        // Require a fresh sync from the next daemon before classifying no-meta
        // connects — its alive set may differ. The ids set is kept as-is: the
        // next sync replaces it wholesale.
        state.daemonTerminalSessions.synced = false;
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
