import { createServer } from 'node:http';
import next from 'next';
import { getAppState } from './src/server/trpc/context';
import { createWebSocketServer } from './src/server/ws/server';
import {
  createTerminalWebSocketServer,
  createTerminalRelayWebSocketServer,
} from './src/server/ws/terminal-server';
import { createEventsWebSocketServer } from './src/server/ws/events-server';
import { broadcastTerminalSessionsChange } from './src/server/ws/broadcast';
import { attachMCP } from './src/server/mcp/index';
import { runMigrations } from './src/server/db/migrate';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  runMigrations();

  const state = getAppState();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Terminal session list endpoint — returns persisted sessions filtered by scope
    if (req.method === 'GET' && url.pathname === '/api/terminal/sessions') {
      const groupKeyParam = url.searchParams.get('groupKey');
      const scopeType = url.searchParams.get('scopeType') ?? '';
      const scopeLabel = url.searchParams.get('scopeLabel') ?? '';

      const sessions = Array.from(state.terminalSessionMeta.entries())
        .filter(([, m]) =>
          groupKeyParam != null
            ? m.groupKey === groupKeyParam
            : m.scopeType === scopeType && m.scopeLabel === scopeLabel,
        )
        .map(([sessionId, m]) => {
          const wsSet = state.terminalSessions.get(sessionId);
          let browserCount = 0;
          if (wsSet) {
            for (const w of wsSet) {
              if (w.readyState === w.OPEN) browserCount++;
            }
          }
          return {
            sessionId,
            scopeType: m.scopeType,
            scopeLabel: m.scopeLabel,
            workingDir: m.workingDir,
            command: m.command,
            groupKey: m.groupKey,
            workspaceSlug: m.workspaceSlug,
            taskId: m.taskId,
            status: browserCount > 0 ? 'active' as const : 'suspended' as const,
            browserCount,
          };
        });

      console.log(`[terminal] GET /api/terminal/sessions → returning ${sessions.length} sessions (total meta: ${state.terminalSessionMeta.size})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // Terminal session rename endpoint
    if (req.method === 'POST' && url.pathname === '/api/terminal/sessions/rename') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { sessionId, newLabel } = JSON.parse(body) as { sessionId: string; newLabel: string };
          if (typeof sessionId !== 'string' || !sessionId || typeof newLabel !== 'string' || !newLabel.trim()) {
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
          meta.scopeLabel = newLabel;
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

    if (url.pathname === '/mcp') return;

    handle(req, res);
  });

  const wss = createWebSocketServer(state);
  const terminalWss = createTerminalWebSocketServer(state);
  const terminalRelayWss = createTerminalRelayWebSocketServer(state);
  const eventsWss = createEventsWebSocketServer(state);
  const nextUpgrade = app.getUpgradeHandler();

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
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
    } else {
      nextUpgrade(req, socket, head);
    }
  });

  attachMCP(server);

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
