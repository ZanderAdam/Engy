import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AppState } from '../trpc/context';
import type { TerminalSpawnCmd, TerminalReconnectCmd, TerminalErrorEvent } from '@engy/common';

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

/**
 * Browser → Server WebSocket for terminal connections.
 * Browser sends compact messages ({ t: 'i', sessionId, d } / { t: 'resize', ... }).
 * These are forwarded RAW to the daemon terminal relay — zero parse on the hot path.
 */
export function createTerminalWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const params = parseQueryParams(req.url ?? '');
    const sessionId = params.get('sessionId');
    const workingDir = params.get('workingDir');
    const command = params.get('command') ?? undefined;
    const cols = parseInt(params.get('cols') ?? '80', 10);
    const rows = parseInt(params.get('rows') ?? '24', 10);
    const scopeType = params.get('scopeType') ?? 'workspace';
    const scopeLabel = params.get('scopeLabel') ?? '';

    if (!sessionId || !workingDir) {
      ws.close(1008, 'Missing sessionId or workingDir');
      return;
    }

    // Reconnect detection: check both active WS and persisted metadata
    const oldWs = state.terminalSessions.get(sessionId);
    if (oldWs && oldWs.readyState === oldWs.OPEN) {
      oldWs.close(1001, 'Replaced by new connection');
    }
    const isReconnect = oldWs !== undefined || state.terminalSessionMeta.has(sessionId);
    state.terminalSessions.set(sessionId, ws);

    // Persist session metadata for restoration across page refreshes
    if (!state.terminalSessionMeta.has(sessionId)) {
      state.terminalSessionMeta.set(sessionId, { scopeType, scopeLabel, workingDir, command });
    }

    const daemon = state.terminalDaemon;
    const daemonReady = daemon && daemon.readyState === daemon.OPEN;

    if (isReconnect) {
      if (daemonReady) {
        daemon.send(JSON.stringify({ t: 'reconnect', sessionId } satisfies TerminalReconnectCmd));
      }
    } else if (daemonReady) {
      daemon.send(
        JSON.stringify({
          t: 'spawn',
          sessionId,
          workingDir,
          command,
          cols,
          rows,
          scopeType,
          scopeLabel,
        } satisfies TerminalSpawnCmd),
      );
    } else {
      sendRaw(
        ws,
        JSON.stringify({ t: 'error', message: 'No daemon connected' } satisfies TerminalErrorEvent),
      );
    }

    // Hot path: forward browser input raw to daemon terminal relay
    ws.on('message', (raw: Buffer | string) => {
      const str = typeof raw === 'string' ? raw : raw.toString('utf-8');

      // Intercept kill messages to clean up session metadata (rare path)
      if (str.startsWith('{"t":"kill"')) {
        const sid = extractSessionId(str);
        if (sid) {
          state.terminalSessionMeta.delete(sid);
          state.terminalSessions.delete(sid);
        }
      }

      const td = state.terminalDaemon;
      if (td && td.readyState === td.OPEN) {
        td.send(str);
      }
    });

    ws.on('close', () => {
      // Only clear the WS reference — keep terminalSessionMeta for session restoration
      if (state.terminalSessions.get(sessionId) === ws) {
        state.terminalSessions.delete(sessionId);
      }
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
    state.terminalDaemon = ws;

    // Hot path: forward daemon terminal output raw to browser
    ws.on('message', (raw: Buffer | string) => {
      const str = typeof raw === 'string' ? raw : raw.toString('utf-8');
      const sessionId = extractSessionId(str);
      if (!sessionId) return;

      const browserWs = state.terminalSessions.get(sessionId);
      if (browserWs) sendRaw(browserWs, str);

      // Exit messages start with {"t":"exit" — no data field to confuse
      const isExit = str.startsWith('{"t":"exit"');
      if (isExit) {
        state.terminalSessions.delete(sessionId);
        state.terminalSessionMeta.delete(sessionId);
      }
    });

    ws.on('close', () => {
      if (state.terminalDaemon === ws) {
        state.terminalDaemon = null;
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
