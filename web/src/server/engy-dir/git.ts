import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';

export function isInsideGitRepo(dir: string): boolean {
  let current = path.resolve(dir);
  const root = path.parse(current).root;
  while (current !== root) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    current = path.dirname(current);
  }
  return false;
}

export async function ensureGitRepo(dir: string): Promise<boolean> {
  if (!fs.existsSync(dir)) return false;
  // The workspace must be its own git repo so memory operations get a self-contained
  // history and the parent's .gitignore doesn't apply. A nested git repo is a clean
  // boundary — git stops walking at the inner .git, so this is safe inside another tree.
  if (fs.existsSync(path.join(dir, '.git'))) return false;

  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Engy');
  await git.addConfig('user.email', 'engy@localhost');
  await git.add('.');
  await git.commit('Initial workspace structure');
  return true;
}
