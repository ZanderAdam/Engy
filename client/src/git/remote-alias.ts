import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GITHUB_HOST = 'github.com';
const SSH_RESOLVE_TIMEOUT_MS = 5_000;

const SCP_REMOTE = /^((?:[^@/\s]+@)?)([^:/\s]+)(:(?!\d+\/|\/\/)[^\s]+)$/;
const SSH_URL_REMOTE = /^(ssh:\/\/(?:[^@/\s]+@)?)([^:/\s]+)((?::\d+)?\/[^\s]+)$/;

type SshHostResolver = (alias: string) => Promise<string | null>;

const resolvedHosts = new Map<string, string | null>();

async function resolveSshHostName(alias: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ssh', ['-G', alias], {
      timeout: SSH_RESOLVE_TIMEOUT_MS,
    });
    const line = stdout.split('\n').find((entry) => entry.startsWith('hostname '));
    return line ? line.slice('hostname '.length).trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function resolveCached(alias: string, resolve: SshHostResolver): Promise<string | null> {
  if (resolvedHosts.has(alias)) return resolvedHosts.get(alias) ?? null;
  const host = await resolve(alias);
  resolvedHosts.set(alias, host);
  return host;
}

export async function expandGithubSshAlias(
  url: string,
  resolve: SshHostResolver = resolveSshHostName,
): Promise<string> {
  const trimmed = url.trim();
  const match = SSH_URL_REMOTE.exec(trimmed) ?? SCP_REMOTE.exec(trimmed);
  if (!match) return url;

  const [, prefix, host, rest] = match;
  if (host.toLowerCase() === GITHUB_HOST) return url;

  const resolved = await resolveCached(host, resolve);
  if (resolved !== GITHUB_HOST) return url;
  return `${prefix}${GITHUB_HOST}${rest}`;
}

export function clearSshHostCache(): void {
  resolvedHosts.clear();
}
