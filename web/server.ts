import { createServer } from 'node:http';
import next from 'next';
import { getAppState } from './src/server/trpc/context';
import { createWebSocketServer } from './src/server/ws/server';
import {
  createTerminalWebSocketServer,
  createTerminalRelayWebSocketServer,
} from './src/server/ws/terminal-server';
import { createEventsWebSocketServer } from './src/server/ws/events-server';
import {
  createVoiceWebSocketServer,
  isVoiceEnabledForWorkspace,
  isTtsEnabledForWorkspace,
} from './src/server/ws/voice-server';
import { broadcastTerminalSessionsChange } from './src/server/ws/broadcast';
import { listTerminalSessions } from './src/server/ws/terminal-session-list';
import {
  loadPersistedTerminalSessions,
  persistTerminalSession,
} from './src/server/ws/terminal-session-store';
import { attachMCP, isMcpPath } from './src/server/mcp/index';
import { isHookPath, handleHookRequest } from './src/server/hooks/index';
import { runMigrations, runPostMigrationBackfills } from './src/server/db/migrate';
import { startPrPoller, stopPrPoller } from './src/server/pr/poller';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  runMigrations();
  runPostMigrationBackfills().catch((err) =>
    console.error('[db] Post-migration backfills failed:', err),
  );

  const state = getAppState();

  // Restore terminal session meta persisted by the previous server process so
  // sessions surviving on the daemon stay listed and reattachable. The daemon's
  // first sync validates the restored entries and purges dead ones.
  loadPersistedTerminalSessions(state);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Terminal session list endpoint — returns persisted sessions filtered by
    // scope, or every session when `all=1` (the command center's global view).
    if (req.method === 'GET' && url.pathname === '/api/terminal/sessions') {
      const sessions = listTerminalSessions(state, {
        all: url.searchParams.get('all') === '1',
        groupKey: url.searchParams.get('groupKey'),
        scopeType: url.searchParams.get('scopeType') ?? '',
        scopeLabel: url.searchParams.get('scopeLabel') ?? '',
      });

      if (dev) {
        console.log(
          `[terminal] GET /api/terminal/sessions → returning ${sessions.length} sessions (total meta: ${state.terminalSessionMeta.size})`,
        );
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // Spoken answers. GET-with-text (not POST) so the browser can play it
    // with a plain `new Audio(url)` — no fetch, no blob, no Web Audio graph.
    if (req.method === 'GET' && url.pathname === '/api/voice/speak') {
      const workspace = url.searchParams.get('workspace');
      const text = url.searchParams.get('text') ?? '';
      const voice = url.searchParams.get('voice');
      if (!isTtsEnabledForWorkspace(workspace)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Spoken replies are not enabled for this workspace.' }));
        return;
      }
      if (!text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Nothing to speak.' }));
        return;
      }
      // Dynamic: a static import would load the native sherpa addon on every
      // server boot, including for workspaces that never turn voice on.
      void import('./src/server/voice/tts')
        .then(async (m) => {
          const wav = await m.synthesize(text, voice);
          res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': String(wav.length),
            'Cache-Control': 'private, max-age=3600',
          });
          res.end(wav);
        })
        .catch((err: unknown) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Synthesis failed.' }),
          );
        });
      return;
    }

    // Per-project terminal activity snapshot — initial hydration for the
    // per-project badges. Returns every project-scoped session's current state;
    // live updates arrive via the TERMINAL_ACTIVITY_CHANGE broadcast.
    if (req.method === 'GET' && url.pathname === '/api/terminal/activity') {
      const sessions = Array.from(state.terminalSessionMeta.entries())
        .filter(([, m]) => m.projectSlug != null)
        .map(([sessionId, m]) => ({
          sessionId,
          projectSlug: m.projectSlug,
          state: m.activityState ?? 'idle',
        }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // Terminal session rename endpoint
    if (req.method === 'POST' && url.pathname === '/api/terminal/sessions/rename') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const { sessionId, newLabel } = JSON.parse(body) as {
            sessionId: string;
            newLabel: string;
          };
          if (
            typeof sessionId !== 'string' ||
            !sessionId ||
            typeof newLabel !== 'string' ||
            !newLabel.trim()
          ) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'sessionId and newLabel are required strings' }));
            return;
          }
          const meta = state.terminalSessionMeta.get(sessionId);
          if (!meta) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }
          meta.renamedLabel = newLabel;
          persistTerminalSession(sessionId, meta);
          broadcastTerminalSessionsChange('renamed', sessionId, meta.groupKey, newLabel);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
        }
      });
      return;
    }

    // Claude Code lifecycle hook POSTs — /hooks/<terminalSessionId>. Mounted
    // above /mcp: both are token-in-path routes handled directly on this
    // server, ahead of Next's handler.
    if (isHookPath(url.pathname)) {
      handleHookRequest(state, req, res);
      return;
    }

    // /mcp and per-session /mcp/<token> are handled by the MCP transport (attachMCP).
    if (isMcpPath(url.pathname)) return;

    handle(req, res);
  });

  const wss = createWebSocketServer(state);
  const terminalWss = createTerminalWebSocketServer(state);
  const terminalRelayWss = createTerminalRelayWebSocketServer(state);
  const eventsWss = createEventsWebSocketServer(state);
  const voiceWss = createVoiceWebSocketServer();
  const nextUpgrade = app.getUpgradeHandler();

  server.on('upgrade', (req, socket, head) => {
    const upgradeUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = upgradeUrl;
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/terminal') {
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalWss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/terminal-relay') {
      terminalRelayWss.handleUpgrade(req, socket, head, (ws) => {
        terminalRelayWss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/events') {
      eventsWss.handleUpgrade(req, socket, head, (ws) => {
        eventsWss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/voice') {
      // Denying here is what keeps voice a true no-op when off: nothing
      // downstream — recognizer, VAD, model download — is ever constructed.
      if (!isVoiceEnabledForWorkspace(upgradeUrl.searchParams.get('workspace'))) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      voiceWss.handleUpgrade(req, socket, head, (ws) => {
        voiceWss.emit('connection', ws, req);
      });
    } else {
      nextUpgrade(req, socket, head);
    }
  });

  attachMCP(server);
  startPrPoller(state);

  server.on('close', () => stopPrPoller(state));

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
