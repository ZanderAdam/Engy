/**
 * Workspace integrity checks for the /engy:validate skill.
 *
 * Checks are grouped by severity: error > warning > info.
 * All checks read from the filesystem and the SQLite DB — no network calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { permanentMemories, frontmatter, fleetingMemories, workspaces } from '../db/schema';
import { getWorkspaceDir } from '../engy-dir/init';
import { update as indexerUpdate } from './indexer';
import { getWorkspaceMatrix } from './trace';
import { localRepoAdapter, type RepoFileAdapter } from '../lib/requirements';
import { resolveWorktreeRoots } from '../trpc/routers/shared';

type Severity = 'error' | 'warning' | 'info';

interface Finding {
  severity: Severity;
  check: string;
  message: string;
  path?: string;
}

interface ValidationReport {
  workspaceId: number;
  workspaceSlug: string;
  findings: Finding[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    total: number;
  };
}

type WorkspaceRow = { id: number; slug: string; docsDir: string | null };

const STALE_MEMORY_DAYS = 180;

// ── Check: stale memories ─────────────────────────────────────────────

function checkStaleMemories(workspaceId: number): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const memRows = db
    .select()
    .from(permanentMemories)
    .where(eq(permanentMemories.workspaceId, workspaceId))
    .all();

  const now = Date.now();
  const thresholdMs = STALE_MEMORY_DAYS * 24 * 60 * 60 * 1000;

  for (const row of memRows) {
    const updatedAt = new Date(row.updatedAt).getTime();
    const ageMs = now - updatedAt;
    if (ageMs > thresholdMs) {
      const daysSinceUpdate = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      findings.push({
        severity: 'warning',
        check: 'stale-memory',
        message: `Memory not updated in ${daysSinceUpdate} days`,
        path: row.filePath ?? undefined,
      });
    }
  }

  return findings;
}

// ── Check: broken links ───────────────────────────────────────────────

function checkBrokenLinks(workspaceId: number, workspaceDir: string): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const memRows = db
    .select()
    .from(permanentMemories)
    .where(eq(permanentMemories.workspaceId, workspaceId))
    .all();

  for (const row of memRows) {
    if (!row.filePath) continue;

    for (const linked of row.linkedMemories ?? []) {
      const absLinked = path.join(workspaceDir, linked);
      if (!fs.existsSync(absLinked)) {
        findings.push({
          severity: 'error',
          check: 'broken-links',
          message: `Linked memory not found on disk: ${linked}`,
          path: row.filePath,
        });
      }
    }

    for (const src of row.sources ?? []) {
      const absSrc = path.join(workspaceDir, src);
      if (!fs.existsSync(absSrc)) {
        findings.push({
          severity: 'warning',
          check: 'broken-links',
          message: `Source reference not found on disk: ${src}`,
          path: row.filePath,
        });
      }
    }
  }

  return findings;
}

// ── Check: schema compliance ──────────────────────────────────────────

function checkSchemaCompliance(workspaceId: number, workspaceDir: string): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const fmRows = db
    .select()
    .from(frontmatter)
    .where(
      and(eq(frontmatter.workspaceId, workspaceId), eq(frontmatter.collection, 'memory')),
    )
    .all();

  for (const row of fmRows) {
    const absPath = path.join(workspaceDir, row.path);
    if (!fs.existsSync(absPath)) continue;

    let fm: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(absPath, 'utf8');
      fm = matter(raw).data ?? {};
    } catch {
      findings.push({
        severity: 'error',
        check: 'schema-compliance',
        message: 'Failed to parse frontmatter',
        path: row.path,
      });
      continue;
    }

    // Only memory/{subtype}/ files need title + subtype (not sources/ or references/).
    const isSubtypeFile = /^memory\/(decisions|patterns|facts|conventions|insights)\//.test(row.path);
    if (!isSubtypeFile) continue;
    // Generated TOC files, not memories.
    if (path.basename(row.path).toLowerCase() === 'readme.md') continue;

    if (!fm.title) {
      findings.push({
        severity: 'warning',
        check: 'schema-compliance',
        message: 'Missing required frontmatter field: title',
        path: row.path,
      });
    }

    if (!fm.subtype) {
      findings.push({
        severity: 'warning',
        check: 'schema-compliance',
        message: 'Missing required frontmatter field: subtype',
        path: row.path,
      });
    }
  }

  return findings;
}

// ── Check: missing sources on subtype memories ────────────────────────

function checkMissingSources(workspaceId: number): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const memRows = db
    .select()
    .from(permanentMemories)
    .where(eq(permanentMemories.workspaceId, workspaceId))
    .all();

  for (const row of memRows) {
    if (!row.subtype) continue;
    if (row.sources && row.sources.length > 0) continue;

    findings.push({
      severity: 'warning',
      check: 'missing-sources',
      message: `Subtype memory has no sources[] — traceability gap`,
      path: row.filePath ?? undefined,
    });
  }

  return findings;
}

// ── Check: duplicate DB paths ─────────────────────────────────────────

function checkDuplicateIds(workspaceId: number): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const memRows = db
    .select()
    .from(permanentMemories)
    .where(eq(permanentMemories.workspaceId, workspaceId))
    .all();

  const seen = new Map<string, number>();
  for (const row of memRows) {
    if (!row.filePath) continue;
    const prev = seen.get(row.filePath);
    if (prev !== undefined) {
      findings.push({
        severity: 'error',
        check: 'duplicate-ids',
        message: `Duplicate permanentMemories path (ids ${prev} and ${row.id})`,
        path: row.filePath,
      });
    } else {
      seen.set(row.filePath, row.id);
    }
  }

  return findings;
}

// ── Check: orphaned content ───────────────────────────────────────────

const MEMORY_SUBTYPES = ['decisions', 'patterns', 'facts', 'conventions', 'insights'] as const;

function walkMemoryFiles(workspaceDir: string): string[] {
  const filePaths: string[] = [];
  for (const subtype of MEMORY_SUBTYPES) {
    const dir = path.join(workspaceDir, 'memory', subtype);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') {
        filePaths.push(`memory/${subtype}/${entry}`);
      }
    }
  }
  return filePaths;
}

function checkOrphanedContent(workspaceId: number, workspaceDir: string): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const memRows = db
    .select()
    .from(permanentMemories)
    .where(eq(permanentMemories.workspaceId, workspaceId))
    .all();

  // DB → file: DB row exists but file is missing on disk.
  for (const row of memRows) {
    if (!row.filePath) continue;
    const absPath = path.join(workspaceDir, row.filePath);
    if (!fs.existsSync(absPath)) {
      findings.push({
        severity: 'error',
        check: 'orphaned-content',
        message: 'permanentMemories DB row has no file on disk',
        path: row.filePath,
      });
    }
  }

  // file → DB: file exists on disk but has no corresponding DB row.
  const knownPaths = new Set(memRows.map((r) => r.filePath).filter(Boolean));
  for (const filePath of walkMemoryFiles(workspaceDir)) {
    if (!knownPaths.has(filePath)) {
      findings.push({
        severity: 'warning',
        check: 'orphaned-content',
        message: `File on disk has no permanentMemories row: ${filePath}`,
        path: filePath,
      });
    }
  }

  return findings;
}

// ── Check: lifecycle consistency ──────────────────────────────────────

function checkLifecycleConsistency(workspaceId: number): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const promoted = db
    .select()
    .from(fleetingMemories)
    .where(
      and(
        eq(fleetingMemories.workspaceId, workspaceId),
        eq(fleetingMemories.promoted, true),
      ),
    )
    .all();

  for (const fleeting of promoted) {
    if (!fleeting.promotedFromId) {
      findings.push({
        severity: 'warning',
        check: 'lifecycle-consistency',
        message: `Promoted fleeting memory (id=${fleeting.id}) missing promotedFromId`,
      });
      continue;
    }

    const permanent = db
      .select()
      .from(permanentMemories)
      .where(eq(permanentMemories.id, fleeting.promotedFromId))
      .get();

    if (!permanent) {
      findings.push({
        severity: 'error',
        check: 'lifecycle-consistency',
        message: `Promoted fleeting memory (id=${fleeting.id}) points to missing permanentMemory id=${fleeting.promotedFromId}`,
      });
    }
  }

  return findings;
}

// ── Check: commit-message conformance ────────────────────────────────

function checkCommitMessages(workspaceDir: string): Finding[] {
  const findings: Finding[] = [];

  try {
    const log = execFileSync(
      'git',
      ['log', '--oneline', '--name-only', '--format=%H %s', '-50'],
      { cwd: workspaceDir, timeout: 5000, encoding: 'utf8' },
    );

    const lines = log.split('\n');
    let currentSubject = '';

    for (const line of lines) {
      if (!line.trim()) continue;
      // Lines starting with a hash are commit lines; others are file paths.
      if (/^[0-9a-f]{7,}/.test(line)) {
        const spaceIdx = line.indexOf(' ');
        currentSubject = spaceIdx > 0 ? line.slice(spaceIdx + 1) : '';
      } else if (line.includes('memory/')) {
        // This file path touches memory/ — check the commit subject.
        if (!/^memory\([^)]+\):/.test(currentSubject)) {
          findings.push({
            severity: 'warning',
            check: 'commit-message-conformance',
            message: `Commit touching memory/ does not follow memory(<op>): convention: "${currentSubject}"`,
            path: line.trim(),
          });
        }
      }
    }
  } catch {
    // Not a git repo or git unavailable — skip this check gracefully.
    findings.push({
      severity: 'info',
      check: 'commit-message-conformance',
      message: 'Could not read git log — skipping commit-message conformance check',
    });
  }

  return findings;
}

// ── Check: index status ───────────────────────────────────────────────

async function checkIndexStatus(workspaceSlug: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  try {
    const results = await indexerUpdate(workspaceSlug);
    const totalNeedsEmbedding = results.reduce((sum, r) => sum + r.needsEmbedding, 0);

    if (totalNeedsEmbedding > 0) {
      findings.push({
        severity: 'info',
        check: 'index-status',
        message: `${totalNeedsEmbedding} file(s) awaiting embedding — run reindex to generate vectors`,
      });
    }
  } catch (err) {
    findings.push({
      severity: 'warning',
      check: 'index-status',
      message: `Could not check index status: ${(err as Error).message}`,
    });
  }

  return findings;
}

// ── Check: requirements traceability ──────────────────────────────────

/**
 * Cross-reference EARS FRs declared in system/features against the FR tags in
 * the workspace's test suite. Surfaces format violations, coverage gaps, and
 * orphaned tags — the feedback signal for the EARS → BDD test → implement loop.
 */
async function checkRequirements(
  workspaceId: number,
  sessionId?: string,
  adapter: RepoFileAdapter = localRepoAdapter,
): Promise<Finding[]> {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!ws) return [];

  const codeRootsOverride = resolveWorktreeRoots(sessionId);
  const matrix = await getWorkspaceMatrix(ws, codeRootsOverride, adapter);
  if (matrix.definitions.length === 0) return []; // no feature FRs authored yet

  const findings: Finding[] = [];

  // Format contract — malformed rows and duplicate ids break the parser's
  // determinism, so they are errors regardless of whether code is scanned.
  for (const m of matrix.malformed) {
    findings.push({
      severity: 'error',
      check: 'requirements-format',
      message: `Malformed requirement row (${m.reason}): ${m.raw}`,
      path: m.file,
    });
  }
  for (const id of matrix.duplicateIds) {
    findings.push({
      severity: 'error',
      check: 'requirements-format',
      message: `FR id ${id} is declared more than once — ids must be unique and never reused`,
    });
  }

  // Determine which roots exist — use the adapter so daemon-backed paths work.
  const roots = codeRootsOverride ?? (ws.repos ?? []);
  const rootChecks = await Promise.all(roots.map((r) => adapter.exists(r)));
  const codeRoots = roots.filter((_, i) => rootChecks[i]);

  if (codeRoots.length === 0) {
    findings.push({
      severity: 'info',
      check: 'requirements-traceability',
      message: `${matrix.definitions.length} FR(s) declared; skipping test-coverage scan (no repos configured)`,
    });
    return findings;
  }

  for (const tag of matrix.orphanTags) {
    findings.push({
      severity: 'error',
      check: 'requirements-traceability',
      message: `Test references ${tag.id} but no feature doc declares it (typo or orphaned tag)`,
      path: `${tag.testFile}:${tag.line}`,
    });
  }
  for (const id of matrix.uncovered) {
    findings.push({
      severity: 'warning',
      check: 'requirements-traceability',
      message: `${id} has no tagged test — coverage gap`,
    });
  }

  return findings;
}

// ── Public entry point ─────────────────────────────────────────────────

export async function validateWorkspace(
  ws: WorkspaceRow,
  sessionId?: string,
  adapter: RepoFileAdapter = localRepoAdapter,
): Promise<ValidationReport> {
  const workspaceDir = getWorkspaceDir(ws);

  const allFindings: Finding[] = [
    ...checkStaleMemories(ws.id),
    ...checkBrokenLinks(ws.id, workspaceDir),
    ...checkSchemaCompliance(ws.id, workspaceDir),
    ...checkMissingSources(ws.id),
    ...checkDuplicateIds(ws.id),
    ...checkOrphanedContent(ws.id, workspaceDir),
    ...checkLifecycleConsistency(ws.id),
    ...checkCommitMessages(workspaceDir),
    ...(await checkRequirements(ws.id, sessionId, adapter)),
    ...(await checkIndexStatus(ws.slug)),
  ];

  const counts = allFindings.reduce(
    (acc, f) => {
      acc[f.severity]++;
      return acc;
    },
    { error: 0, warning: 0, info: 0 },
  );

  return {
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    findings: allFindings,
    summary: {
      errors: counts.error,
      warnings: counts.warning,
      infos: counts.info,
      total: allFindings.length,
    },
  };
}
