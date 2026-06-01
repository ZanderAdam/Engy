import { spawn } from 'node:child_process';
import getPort from 'get-port';

// .dev.env is already loaded by dotenv-cli (see the root `dev` script).
// Pick the preferred port if free, otherwise let the OS assign a free one,
// then hand the same port to both web (PORT) and client (ENGY_SERVER_URL).
const preferred = parseInt(process.env.PORT ?? '4000', 10);
const port = await getPort({ port: preferred });

const note = port === preferred ? '' : ` (preferred ${preferred} was busy)`;
console.log(`[dev] web + client running on http://localhost:${port}${note}`);

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
