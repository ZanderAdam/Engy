import { spawn } from 'node:child_process';
import getPort from 'get-port';

// .dev.env is already loaded by dotenv-cli (see the root `dev` script).
// Always pick a free port (honouring PORT only when it is explicitly set),
// then hand the same port to both web (PORT) and client (ENGY_SERVER_URL).
const port = await getPort(process.env.PORT ? { port: parseInt(process.env.PORT, 10) } : undefined);

console.log(`[dev] web + client running on http://localhost:${port}`);

const child = spawn('turbo', ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(port),
    ENGY_SERVER_URL: `http://localhost:${port}`,
  },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
