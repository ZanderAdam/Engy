import { spawn } from 'node:child_process';
import getPort from 'get-port';

// .dev.env is already loaded by dotenv-cli (see the root `dev` script).
// Pick the preferred port if free, otherwise let the OS assign a free one,
// then hand the same port to both web (PORT) and client (ENGY_SERVER_URL).
const preferred = parseInt(process.env.PORT ?? '4000', 10);
const port = await getPort({ port: preferred });

const note = port === preferred ? '' : ` (preferred ${preferred} was busy)`;
console.log(`[dev] web + client running on http://localhost:${port}${note}`);

// shell:true so Windows resolves the `turbo.cmd` shim — a bare spawn('turbo')
// can't exec a .cmd by name and throws ENOENT on Windows. The command is passed
// as a single string (not an args array) to avoid Node's DEP0190 warning under
// shell:true; the arguments are static, so there is no injection risk.
const child = spawn('turbo run dev', {
  stdio: 'inherit',
  shell: true,
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
