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
import { permanentMemories, frontmatter, fleetingMemories } from '../db/schema';
import { getWorkspaceDir } from '../engy-dir/init';
import { update as indexerUpdate } from './indexer';

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

function checkOrphanedContent(workspaceId: number, workspaceDir: string): Finding[] {
  const findings: Finding[] = [];
  const db = getDb();

  const memRows = db
    .select()
    .from(permanentMemories)
    .where(eq(permanentMemories.workspaceId, workspaceId))
    .all();

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
      ['log', '--oneline', '--diff-filter=A', '--name-only', '--format=%H %s', '-50'],
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

// ── Public entry point ─────────────────────────────────────────────────

export async function validateWorkspace(ws: WorkspaceRow): Promise<ValidationReport> {
  const workspaceDir = getWorkspaceDir(ws);

  const allFindings: Finding[] = [
    ...checkBrokenLinks(ws.id, workspaceDir),
    ...checkSchemaCompliance(ws.id, workspaceDir),
    ...checkDuplicateIds(ws.id),
    ...checkOrphanedContent(ws.id, workspaceDir),
    ...checkLifecycleConsistency(ws.id),
    ...checkCommitMessages(workspaceDir),
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
