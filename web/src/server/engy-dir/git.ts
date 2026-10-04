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

export async function ensureGitRepo(
  dir: string,
  { nestInParentRepo = true }: { nestInParentRepo?: boolean } = {},
): Promise<boolean> {
  if (!fs.existsSync(dir)) return false;
  if (fs.existsSync(path.join(dir, '.git'))) return false;
  // A nested repo captures every git lookup below it, so a user's docsDir inside a repo uses
  // that repo. Engy-owned dirs still nest: a parent that gitignores a dev ENGY_DIR would
  // reject memory commits.
  if (!nestInParentRepo && isInsideGitRepo(dir)) return false;

  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Engy');
  await git.addConfig('user.email', 'engy@localhost');
  // Avoid inheriting a global signing requirement the host may have enforced
  // (devcontainers and managed CI environments often do): workspace init has
  // no signing key and would otherwise fail at the initial commit.
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  // memory(init) prefix keeps the commit conformant with the memory(<op>):
  // convention checked by validateWorkspace (the commit seeds memory/ READMEs).
  await git.commit('memory(init): initial workspace structure');
  return true;
}
