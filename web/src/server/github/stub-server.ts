import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface StubReply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface StubGithub {
  url: string;
  requests: StubRequest[];
  reply: (handler: (req: StubRequest) => StubReply) => void;
  close: () => Promise<void>;
}

export async function startStubGithub(): Promise<StubGithub> {
  const requests: StubRequest[] = [];
  let handler: (req: StubRequest) => StubReply = () => ({ status: 200, body: {} });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const stubRequest: StubRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      };
      requests.push(stubRequest);
      const reply = handler(stubRequest);
      const payload = reply.body === undefined ? '' : JSON.stringify(reply.body);
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
      res.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply: (next) => {
      handler = next;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
