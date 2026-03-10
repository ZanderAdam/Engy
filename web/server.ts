import { createServer } from 'node:http';
import next from 'next';
import { getAppState } from './src/server/trpc/context';
import { createWebSocketServer } from './src/server/ws/server';
import {
  createTerminalWebSocketServer,
  createTerminalRelayWebSocketServer,
} from './src/server/ws/terminal-server';
import { createEventsWebSocketServer } from './src/server/ws/events-server';
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
      const scopeType = url.searchParams.get('scopeType') ?? '';
      const scopeLabel = url.searchParams.get('scopeLabel') ?? '';

      const sessions = Array.from(state.terminalSessionMeta.entries())
        .filter(([, m]) => m.scopeType === scopeType && m.scopeLabel === scopeLabel)
        .map(([sessionId, m]) => ({
          sessionId,
          scopeType: m.scopeType,
          scopeLabel: m.scopeLabel,
          workingDir: m.workingDir,
          command: m.command,
        }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

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
