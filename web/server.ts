import { createServer } from 'node:http';
import next from 'next';
import { attachWebSocket } from './src/server/ws/server.js';
import { attachMCP } from './src/server/mcp/index.js';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  attachWebSocket(server);
  attachMCP(server);

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
