import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  UsageReducerVersion,
  UsageScanFileState,
  UsageSessionMeta,
  UsageSessionScan,
  UsageSessionScanResult,
} from '@engy/common';
import { SessionReducer, USAGE_REDUCER_VERSION } from './reducer.js';
import { localDateString } from './date.js';

const PROJECTS_DIR = ['.claude', 'projects'];
const SESSION_META_DIR = ['.claude', 'usage-data', 'session-meta'];
const SUBAGENTS_DIR = 'subagents';
const WORKTREE_SEGMENT = path.join('.claude', 'worktrees');
const TIMESTAMP_MARKER = '"timestamp":"';
const NEWLINE_BYTE = 0x0a;
const CR_BYTE = 0x0d;

interface UsageScanOptions {
  homeDir: string;
  knownFiles: Record<string, UsageScanFileState>;
  sealedDates: ReadonlySet<string>;
  /** ISO date (YYYY-MM-DD). A transcript whose own mtime predates it is left unread for a later scan. */
  since?: string;
}

interface UsageScanResult {
  sessions: UsageSessionScanResult[];
  files: Record<string, UsageScanFileState>;
  newlySealedDates: string[];
  reducerVersion: UsageReducerVersion;
}

interface TranscriptFile {
  filePath: string;
  slug: string;
  sessionId: string;
  parentSessionId: string | null;
  /** Session-meta enrichment path (main sessions) or the agent's own sidecar (subagents). */
  metaPath: string;
}

export async function scanUsage(options: UsageScanOptions): Promise<UsageScanResult> {
  const { homeDir, knownFiles, sealedDates, since } = options;
  const transcripts = await discoverTranscriptFiles(homeDir);

  const outFiles: Record<string, UsageScanFileState> = {};
  const sessions: UsageSessionScanResult[] = [];

  for (const file of transcripts) {
    const stats = await stat(file.filePath).catch(() => null);
    if (!stats) continue;

    const known = knownFiles[file.filePath];
    const unchanged =
      known !== undefined && known.sizeBytes === stats.size && known.mtimeMs === stats.mtimeMs;

    if (unchanged) {
      outFiles[file.filePath] = known;
      continue;
    }

    // A file older than the window is skipped unread. Recording it as scanned
    // would make it look unchanged forever, so its history would be lost until
    // a rebuild; carrying the prior state forward, or none at all, lets a later
    // scan without a window still read it in full.
    if (since && localDateString(new Date(stats.mtimeMs)) < since) {
      if (known) outFiles[file.filePath] = known;
      continue;
    }

    // A changed file is read again from byte 0: content from an earlier read is re-read by every
    // later API call, so a read of the appended lines only would lose that part of its cost.
    const agentMeta = file.parentSessionId ? await readSubagentMeta(file.metaPath) : null;
    const pass = await scanTranscriptFile(file.filePath, {
      sessionId: file.sessionId,
      slug: file.slug,
      parentSessionId: file.parentSessionId,
      ...agentMeta,
    });

    outFiles[file.filePath] = {
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      firstLineDate: pass.firstLineDate,
      lastLineDate: pass.lastLineDate,
    };

    if (pass.linesRead === 0) continue;

    sessions.push({
      scan: pass.scan,
      repoRoot: await deriveRepoRoot(pass.scan.session.cwd),
      meta: file.parentSessionId ? null : await readSessionMeta(file.metaPath),
    });
  }

  return {
    sessions,
    files: outFiles,
    // A windowed scan did not read every file, so it has no basis to seal a date.
    newlySealedDates: since ? [] : computeNewlySealedDates(outFiles, sealedDates),
    reducerVersion: USAGE_REDUCER_VERSION,
  };
}

async function discoverTranscriptFiles(homeDir: string): Promise<TranscriptFile[]> {
  const projectsDir = path.join(homeDir, ...PROJECTS_DIR);
  const slugEntries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const files: TranscriptFile[] = [];

  for (const slugEntry of slugEntries) {
    if (!slugEntry.isDirectory()) continue;
    const slug = slugEntry.name;
    const slugDir = path.join(projectsDir, slug);
    const entries = await readdir(slugDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const sessionId = entry.name.slice(0, -'.jsonl'.length);
        files.push({
          filePath: path.join(slugDir, entry.name),
          slug,
          sessionId,
          parentSessionId: null,
          metaPath: path.join(homeDir, ...SESSION_META_DIR, `${sessionId}.json`),
        });
        continue;
      }
      if (!entry.isDirectory()) continue;

      // Only `subagents/` is a transcript source — the sibling `tool-results/`
      // directory never holds JSONL rows and is never traversed.
      const subagentsDir = path.join(slugDir, entry.name, SUBAGENTS_DIR);
      const subagentEntries = await readdir(subagentsDir, { withFileTypes: true }).catch(() => []);
      for (const sub of subagentEntries) {
        if (!sub.isFile() || !sub.name.endsWith('.jsonl')) continue;
        const sessionId = sub.name.slice(0, -'.jsonl'.length);
        files.push({
          filePath: path.join(subagentsDir, sub.name),
          slug,
          sessionId,
          parentSessionId: entry.name,
          metaPath: path.join(subagentsDir, `${sessionId}.meta.json`),
        });
      }
    }
  }

  return files;
}

interface ScanPass {
  scan: UsageSessionScan;
  linesRead: number;
  firstLineDate: string | null;
  lastLineDate: string | null;
}

async function scanTranscriptFile(
  filePath: string,
  reducerOptions: {
    sessionId: string;
    slug: string;
    parentSessionId: string | null;
    agentType?: string | null;
    description?: string | null;
  },
): Promise<ScanPass> {
  const reducer = new SessionReducer({
    sessionId: reducerOptions.sessionId,
    slug: reducerOptions.slug,
    parentSessionId: reducerOptions.parentSessionId,
    agentType: reducerOptions.agentType ?? null,
    agentDescription: reducerOptions.description ?? null,
  });

  const stream = createReadStream(filePath);

  let linesRead = 0;
  let firstLineDate: string | null = null;
  let lastLineDate: string | null = null;
  let pending = Buffer.alloc(0);

  // A refresh can run mid-append: the file's last line may not be
  // newline-terminated yet. Buffering raw bytes (instead of readline, which
  // treats end-of-stream as an implicit terminator) leaves a trailing partial
  // line unread until the next scan sees it whole.
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    pending = Buffer.concat([pending, chunk]);

    let newlineIndex = pending.indexOf(NEWLINE_BYTE);
    while (newlineIndex !== -1) {
      let lineEnd = newlineIndex;
      if (lineEnd > 0 && pending[lineEnd - 1] === CR_BYTE) lineEnd -= 1;
      const line = pending.toString('utf8', 0, lineEnd);
      pending = pending.subarray(newlineIndex + 1);
      linesRead += 1;

      const date = extractDate(line);
      if (date) {
        if (firstLineDate === null) firstLineDate = date;
        lastLineDate = date;
      }
      reducer.addLine(line);

      newlineIndex = pending.indexOf(NEWLINE_BYTE);
    }
  }

  return { scan: reducer.finish(), linesRead, firstLineDate, lastLineDate };
}

/**
 * Cheap substring extraction — avoids a JSON.parse on every line just to find
 * its date. The seal boundary is a local date (see `date.ts`), so the
 * substring has to become a `Date` rather than being sliced off the UTC timestamp.
 */
function extractDate(line: string): string | null {
  const idx = line.indexOf(TIMESTAMP_MARKER);
  if (idx === -1) return null;
  const start = idx + TIMESTAMP_MARKER.length;
  const end = line.indexOf('"', start);
  if (end === -1) return null;
  const timestamp = line.slice(start, end);
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : localDateString(parsed);
}

async function readSessionMeta(metaPath: string): Promise<UsageSessionMeta | null> {
  const raw = await readFile(metaPath, 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      durationMinutes: numberOrNull(parsed.duration_minutes),
      firstPrompt: stringOrNull(parsed.first_prompt),
      linesAdded: numberOrNull(parsed.lines_added),
      linesRemoved: numberOrNull(parsed.lines_removed),
      filesModified: numberOrNull(parsed.files_modified),
      gitCommits: numberOrNull(parsed.git_commits),
      toolErrors: numberOrNull(parsed.tool_errors),
    };
  } catch {
    return null;
  }
}

async function readSubagentMeta(
  metaPath: string,
): Promise<{ agentType: string | null; description: string | null } | null> {
  const raw = await readFile(metaPath, 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      agentType: stringOrNull(parsed.agentType),
      description: stringOrNull(parsed.description),
    };
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function findGitRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    const hasGit = await stat(path.join(dir, '.git'))
      .then(() => true)
      .catch(() => false);
    if (hasGit) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `<repo>/.claude/worktrees/<name>` collapses back to `<repo>`, per client/src/runner/index.ts's WORKTREE_DIR. */
function collapseWorktreeRoot(gitRoot: string): string {
  const marker = `${path.sep}${WORKTREE_SEGMENT}${path.sep}`;
  const idx = gitRoot.indexOf(marker);
  return idx === -1 ? gitRoot : gitRoot.slice(0, idx);
}

async function deriveRepoRoot(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  const gitRoot = await findGitRoot(cwd);
  return gitRoot ? collapseWorktreeRoot(gitRoot) : null;
}

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Transcripts are append-only and chronological, and a resumed session appends
 * lines stamped at resume time — never backdated. So no file can ever gain a
 * line dated before today, which makes every past date sealable. Taking the
 * minimum last-line date across all files instead would let one long-finished
 * session pin the boundary and stop anything sealing at all.
 */
function computeNewlySealedDates(
  files: Record<string, UsageScanFileState>,
  sealedDates: ReadonlySet<string>,
): string[] {
  let earliest: string | null = null;
  for (const state of Object.values(files)) {
    if (state.firstLineDate !== null && (earliest === null || state.firstLineDate < earliest)) {
      earliest = state.firstLineDate;
    }
  }
  if (earliest === null) return [];

  const today = localDateString(new Date());
  const newlySealed: string[] = [];
  for (let d = earliest; d < today; d = nextDay(d)) {
    if (!sealedDates.has(d)) newlySealed.push(d);
  }
  return newlySealed;
}
