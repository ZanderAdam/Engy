import fs from 'node:fs';
import path from 'node:path';
import { getEngyDir } from '../db/client.js';

export function initWorkspaceDir(name: string, slug: string, repos: string[]): void {
  const dir = path.join(getEngyDir(), slug);
  fs.mkdirSync(dir, { recursive: true });

  // workspace.yaml
  const yamlContent = [
    `name: ${name}`,
    `slug: ${slug}`,
    'repos:',
    ...repos.map((r) => `  - path: ${r}`),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), yamlContent + '\n');

  // system/ structure
  fs.mkdirSync(path.join(dir, 'system', 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'system', 'technical'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'system', 'overview.md'),
    `# ${name}\n\nWorkspace overview — edit this file to describe your project.\n`,
  );

  // Empty directories
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
}

export function removeWorkspaceDir(slug: string): void {
  const dir = path.join(getEngyDir(), slug);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
