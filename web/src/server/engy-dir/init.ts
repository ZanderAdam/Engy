import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { getEngyDir } from '../db/client';

function validateSlug(slug: string): void {
  if (!slug || /[\/\\]/.test(slug) || slug.includes('..') || slug === '.') {
    throw new Error(`Invalid workspace slug: ${slug}`);
  }
}

export function getWorkspaceDir(workspace: { slug: string; docsDir: string | null }): string {
  return workspace.docsDir ?? path.join(getEngyDir(), workspace.slug);
}

export function initWorkspaceDir(
  name: string,
  slug: string,
  repos: string[],
  docsDir?: string,
): void {
  validateSlug(slug);

  const dir = docsDir ?? path.join(getEngyDir(), slug);
  fs.mkdirSync(dir, { recursive: true });

  const config: Record<string, unknown> = { name, slug, repos: repos.map((r) => ({ path: r })) };
  if (docsDir) {
    config.docsDir = docsDir;
  }
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), yaml.dump(config, { lineWidth: -1 }));

  fs.mkdirSync(path.join(dir, 'system', 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'system', 'technical'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'system', 'overview.md'),
    `# ${name}\n\nWorkspace overview — edit this file to describe your project.\n`,
  );

  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
}

export function removeWorkspaceDir(slug: string, docsDir?: string | null): void {
  validateSlug(slug);

  let resolved: string;

  if (docsDir) {
    resolved = path.resolve(docsDir);
  } else {
    const engyDir = path.resolve(getEngyDir());
    const dir = path.join(engyDir, slug);
    resolved = path.resolve(dir);

    const rel = path.relative(engyDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected for slug: ${slug}`);
    }
  }

  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
