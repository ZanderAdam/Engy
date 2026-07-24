import { RiHistoryLine, RiRobot2Line } from '@remixicon/react';
import { buildAgentCommand, type WorkspaceAgentSettings } from '@/lib/agent-types';
import { projectGroupKey, workspaceGroupKey } from './group-key';
import type { ContainerMode, TerminalDropdownEntry, TerminalDropdownGroup } from './types';

/** Structural mirror of the server's SessionHistoryRow (tRPC-inferred). */
export interface SessionHistoryItem {
  sessionId: string;
  agentType: string;
  workingDir: string;
  scopeLabel: string;
  summary: string;
  workspaceSlug: string | null;
  projectSlug: string | null;
  worktreeBranch: string | null;
  containerMode: string | null;
  startedAt: string;
  closedAt: string | null;
}

interface SessionHistoryGroupOptions {
  workspaceSlug: string;
  mcpUrl: string | undefined;
  agentSettings: WorkspaceAgentSettings | null | undefined;
  /** Project docs dir re-granted via --add-dir, like fresh agent spawns. */
  projectDir?: string;
  /** Offer "Resume Codex session…" pickers (only where codex history exists). */
  codexActive?: boolean;
  /** Injected clock for deterministic relative-time labels. */
  now: number;
  maxPerDir?: number;
}

const MAX_SUMMARY_LABEL_LENGTH = 60;
const DEFAULT_MAX_PER_DIR = 10;

export function relativeTime(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_LABEL_LENGTH) return text;
  return `${text.slice(0, MAX_SUMMARY_LABEL_LENGTH - 1)}…`;
}

function dirLabel(workingDir: string, branch: string | undefined): string {
  const dirName = workingDir.split('/').filter(Boolean).pop() ?? workingDir;
  return branch ? `${dirName} (${branch})` : dirName;
}

interface DirBucket {
  workingDir: string;
  branch: string | undefined;
  rows: SessionHistoryItem[];
  hasCodexPicker: boolean;
}

/**
 * Build the "Resume Session" dropdown group: a submenu per directory that has
 * recorded session history — Claude sessions as by-id resume entries (summary
 * + recency), and a Codex picker entry (`codex resume`) only where Codex
 * sessions actually ran (Codex ids are not tracked, see FR-TERMINAL-370).
 * Returns undefined when there is nothing to offer.
 */
export function buildSessionHistoryGroup(
  rows: SessionHistoryItem[],
  opts: SessionHistoryGroupOptions,
): TerminalDropdownGroup | undefined {
  const maxPerDir = opts.maxPerDir ?? DEFAULT_MAX_PER_DIR;
  const buckets = new Map<string, DirBucket>();

  for (const row of rows) {
    let bucket = buckets.get(row.workingDir);
    if (!bucket) {
      bucket = {
        workingDir: row.workingDir,
        branch: row.worktreeBranch ?? undefined,
        rows: [],
        hasCodexPicker: false,
      };
      buckets.set(row.workingDir, bucket);
    }
    if (row.agentType === 'claude') {
      // Only Claude sessions are resumable by id — history rows are keyed by
      // the terminal session id, which codex never adopts as its own.
      bucket.rows.push(row);
    } else if (row.agentType === 'codex' && opts.codexActive) {
      bucket.hasCodexPicker = true;
    }
  }
  // Codex-only directories with the picker suppressed have nothing to offer.
  for (const [dir, bucket] of buckets) {
    if (bucket.rows.length === 0 && !bucket.hasCodexPicker) buckets.delete(dir);
  }
  if (buckets.size === 0) return undefined;

  function groupKeyFor(row: { projectSlug: string | null; worktreeBranch: string | null }): string {
    if (row.projectSlug) {
      return projectGroupKey(opts.workspaceSlug, row.projectSlug, row.worktreeBranch ?? undefined);
    }
    return workspaceGroupKey(opts.workspaceSlug);
  }

  function resumeEntry(row: SessionHistoryItem): TerminalDropdownEntry {
    const when = relativeTime(row.closedAt ?? row.startedAt, opts.now);
    const summary = row.summary || row.scopeLabel;
    return {
      id: `resume:${row.sessionId}`,
      label: `${truncate(summary)} · ${when}`,
      tooltip: `${summary} — ${row.workingDir}`,
      icon: RiHistoryLine,
      scope: {
        scopeType: row.projectSlug ? 'project' : 'workspace',
        scopeLabel: row.scopeLabel,
        workingDir: row.workingDir,
        command: buildAgentCommand('claude', {
          resumeSessionId: row.sessionId,
          mcpUrl: opts.mcpUrl,
          agentSettings: opts.agentSettings,
          additionalDirs: opts.projectDir ? [opts.projectDir] : undefined,
        }),
        groupKey: groupKeyFor(row),
        workspaceSlug: opts.workspaceSlug,
        containerMode: (row.containerMode ?? undefined) as ContainerMode | undefined,
        projectSlug: row.projectSlug ?? undefined,
        worktreeBranch: row.worktreeBranch ?? undefined,
        agentType: 'claude',
        resumedFrom: row.sessionId,
      },
    };
  }

  function codexPickerEntry(bucket: DirBucket): TerminalDropdownEntry {
    return {
      id: `resume-codex:${bucket.workingDir}`,
      label: 'Resume Codex session…',
      tooltip: `codex resume picker in ${bucket.workingDir}`,
      icon: RiRobot2Line,
      scope: {
        scopeType: 'workspace',
        scopeLabel: `codex: ${dirLabel(bucket.workingDir, bucket.branch)}`,
        workingDir: bucket.workingDir,
        command: buildAgentCommand('codex', { resumeSessionId: '' }),
        groupKey: workspaceGroupKey(opts.workspaceSlug),
        workspaceSlug: opts.workspaceSlug,
        worktreeBranch: bucket.branch,
        agentType: 'codex',
      },
    };
  }

  // Most recently active directory first; codex-only directories trail. Plain
  // string comparison — ISO timestamps sort lexicographically.
  const recency = (bucket: DirBucket): string =>
    bucket.rows[0] ? (bucket.rows[0].closedAt ?? bucket.rows[0].startedAt) : '';
  const sorted = [...buckets.values()].sort((a, b) => {
    if (recency(a) === recency(b)) return 0;
    return recency(a) > recency(b) ? -1 : 1;
  });

  const entries = sorted.map<TerminalDropdownEntry>((bucket) => ({
    id: `resume-dir:${bucket.workingDir}`,
    label: dirLabel(bucket.workingDir, bucket.branch),
    icon: RiHistoryLine,
    children: [
      ...bucket.rows.slice(0, maxPerDir).map(resumeEntry),
      ...(bucket.hasCodexPicker ? [codexPickerEntry(bucket)] : []),
    ],
  }));

  return { label: 'Resume Session', entries };
}
