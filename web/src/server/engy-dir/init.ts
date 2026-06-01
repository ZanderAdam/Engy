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

export function resolveProjectDir(
  workspace: { slug: string; docsDir: string | null },
  project: { projectDir: string | null; slug: string },
): string {
  const slug = project.projectDir ?? project.slug;
  return path.join(getWorkspaceDir(workspace), 'projects', slug);
}

interface WorkspaceSkills {
  planSkill?: string | null;
  implementSkill?: string | null;
  earsBdd?: boolean;
}

export function writeWorkspaceYaml(
  dir: string,
  name: string,
  slug: string,
  repos: string[],
  docsDir?: string | null,
  skills?: WorkspaceSkills,
): void {
  const config: Record<string, unknown> = { name, slug, repos: repos.map((r) => ({ path: r })) };
  if (docsDir) config.docsDir = docsDir;
  if (skills?.planSkill) config.planSkill = skills.planSkill;
  if (skills?.implementSkill) config.implementSkill = skills.implementSkill;
  if (skills?.earsBdd) config.earsBdd = true;
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), yaml.dump(config, { lineWidth: -1 }));
}

export function initWorkspaceDir(
  name: string,
  slug: string,
  repos: string[],
  docsDir?: string,
  skills?: WorkspaceSkills,
): void {
  validateSlug(slug);

  const dir = docsDir ?? path.join(getEngyDir(), slug);
  fs.mkdirSync(dir, { recursive: true });

  writeWorkspaceYaml(dir, name, slug, repos, docsDir, skills);

  fs.mkdirSync(path.join(dir, 'system', 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'system', 'technical'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'system', 'overview.md'),
    `# ${name}\n\nWorkspace overview — edit this file to describe your project.\n`,
  );
  seedReadme(path.join(dir, 'system'), 'system');
  seedReadme(path.join(dir, 'system', 'features'), 'system/features');
  seedReadme(path.join(dir, 'system', 'technical'), 'system/technical');

  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

  initMemoryDirs(dir);
}

const MEMORY_SUBTYPES = ['decisions', 'patterns', 'facts', 'conventions', 'insights'] as const;
const INGESTION_DIRS = ['sources', 'references'] as const;

const README_DESCRIPTIONS: Record<string, { prose: string; description: string }> = {
  'system': {
    description: 'Workspace system documentation — overview, features, and technical concerns',
    prose: "This directory holds the workspace's living system documentation. Start with `overview.md` for the high-level narrative, then read the `features/` and `technical/` docs in order.",
  },
  'system/features': {
    description: 'Major feature areas of the workspace',
    prose: 'One doc per major feature area, ordered for top-to-bottom reading.',
  },
  'system/technical': {
    description: 'Cross-cutting technical concerns and architecture',
    prose: 'One doc per major architectural concern, ordered for top-to-bottom reading.',
  },
  'memory': {
    description: 'Workspace knowledge base — permanent notes, source snapshots, and references',
    prose: 'This directory holds the workspace knowledge base organised into the Zettelkasten permanent note subtypes, source ingestion snapshots, and durable reference records.',
  },
  'memory/decisions': {
    description: 'Choices made with rationale',
    prose: 'Permanent notes capturing significant decisions — what was chosen, what alternatives were considered, and why.',
  },
  'memory/patterns': {
    description: 'Recurring solutions and approaches',
    prose: 'Permanent notes on recurring patterns — reusable solutions, design motifs, and implementation approaches encountered across projects.',
  },
  'memory/facts': {
    description: 'Verified information',
    prose: 'Permanent notes on verified facts — confirmed behaviours, measured metrics, and other grounded observations.',
  },
  'memory/conventions': {
    description: 'Agreed practices and standards',
    prose: 'Permanent notes on conventions — agreed coding standards, process norms, and team practices.',
  },
  'memory/insights': {
    description: 'Observations and learnings',
    prose: 'Permanent notes on insights — observations, hypotheses, and learnings that do not yet fit another category.',
  },
  'memory/sources': {
    description: 'Immutable snapshots of non-durable content',
    prose: 'Immutable snapshots of ephemeral content — Slack threads, meeting transcripts, articles, and other non-durable sources. Each file carries provenance frontmatter (URL, source type, ingester, title).',
  },
  'memory/references': {
    description: 'Durable external link records',
    prose: 'Durable reference records for stable external content — versioned RFCs, internal docs, repository paths with SHAs. Frontmatter only; no body snapshot needed.',
  },
};

function seedReadme(dir: string, key: string): void {
  const readmePath = path.join(dir, 'README.md');
  if (fs.existsSync(readmePath)) return;

  const meta = README_DESCRIPTIONS[key];
  if (!meta) return;

  const content =
    `---\ndescription: ${meta.description}\n---\n\n${meta.prose}\n\n<!-- INDEX START -->\n<!-- INDEX END -->\n`;
  fs.writeFileSync(readmePath, content, 'utf8');
}

export function initMemoryDirs(workspaceDir: string): void {
  // Collection root
  fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });
  seedReadme(path.join(workspaceDir, 'memory'), 'memory');

  // Subtype dirs
  for (const subtype of MEMORY_SUBTYPES) {
    const subtypeDir = path.join(workspaceDir, 'memory', subtype);
    fs.mkdirSync(subtypeDir, { recursive: true });
    seedReadme(subtypeDir, `memory/${subtype}`);
  }

  // Ingestion dirs
  for (const ingDir of INGESTION_DIRS) {
    const fullDir = path.join(workspaceDir, 'memory', ingDir);
    fs.mkdirSync(fullDir, { recursive: true });
    seedReadme(fullDir, `memory/${ingDir}`);
  }
}

export function renameWorkspaceDir(oldSlug: string, newSlug: string): void {
  validateSlug(oldSlug);
  validateSlug(newSlug);

  const engyDir = path.resolve(getEngyDir());
  const oldDir = path.join(engyDir, oldSlug);
  const newDir = path.join(engyDir, newSlug);

  for (const [label, dir] of [['old', oldDir], ['new', newDir]] as const) {
    const rel = path.relative(engyDir, path.resolve(dir));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected for ${label} slug`);
    }
  }

  if (!fs.existsSync(oldDir)) {
    throw new Error(`Workspace directory does not exist: ${oldDir}`);
  }
  if (fs.existsSync(newDir)) {
    throw new Error(`Target directory already exists: ${newDir}`);
  }

  fs.renameSync(oldDir, newDir);
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
