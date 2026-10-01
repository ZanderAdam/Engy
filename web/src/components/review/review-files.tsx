'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEditorTabs } from '@/components/editor/use-editor-tabs';
import { DiffReviewSurface, type DiffSource } from '@/components/diff/diff-review-surface';
import { ReviewWriteProvider } from '@/components/diff/review-write-context';
import { useReviewWriteActions } from './use-review-write';
import { ReviewErrorMessage } from './review-status-message';
import { patchContentId, patchSpecFor } from '@/components/diff/diff-patch-spec';
import {
  classifyPaths,
  implementationLinesFromPatches,
  orderByClass,
  parseGitattributes,
  type LineCount,
} from '@/components/diff/file-classes';

interface ReviewFilesProps {
  workspaceSlug: string;
  workspaceId: number;
  repoFullName: string;
  prNumber: number;
  projectSlug: string | null;
  repoPath: string;
  worktreePath: string;
  headRefName: string;
  baseRef: string | null;
  totalLines: LineCount;
  active: boolean;
}

type LineMode = 'implementation' | 'total';

const LINE_MODE_STORAGE_KEY = 'engy-review-line-mode';
const DEFAULT_BASE_REF = 'main';

function readLineMode(): LineMode {
  try {
    return localStorage.getItem(LINE_MODE_STORAGE_KEY) === 'total' ? 'total' : 'implementation';
  } catch {
    return 'implementation';
  }
}

function useLineMode(): [LineMode, (mode: LineMode) => void] {
  const [mode, setMode] = useState<LineMode>(readLineMode);
  const update = (next: LineMode) => {
    setMode(next);
    try {
      localStorage.setItem(LINE_MODE_STORAGE_KEY, next);
    } catch {
      return;
    }
  };
  return [mode, update];
}

function LineCountBar({
  lines,
  mode,
  onModeChange,
}: {
  lines: LineCount | null;
  mode: LineMode;
  onModeChange: (mode: LineMode) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs">
      <span className="text-muted-foreground">Lines</span>
      <span className="font-mono tabular-nums">
        {lines ? (
          <>
            <span className="text-green-500">+{lines.added}</span>{' '}
            <span className="text-red-500">−{lines.removed}</span>
          </>
        ) : (
          <span className="text-muted-foreground">…</span>
        )}
      </span>
      <div className="flex">
        {(['implementation', 'total'] as const).map((value) => (
          <Button
            key={value}
            variant="ghost"
            size="xs"
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className={cn('capitalize', mode === value && 'bg-muted text-foreground')}
          >
            {value}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ReviewFiles({
  workspaceSlug,
  workspaceId,
  repoFullName,
  prNumber,
  projectSlug,
  repoPath,
  worktreePath,
  headRefName,
  baseRef,
  totalLines,
  active,
}: ReviewFilesProps) {
  const tabs = useEditorTabs();
  const reviewWrite = useReviewWriteActions({ workspaceId, repoFullName, prNumber });
  const [lineMode, setLineMode] = useLineMode();
  const base = `origin/${baseRef ?? DEFAULT_BASE_REF}`;

  const [baseFetched, setBaseFetched] = useState(false);
  const { mutate: fetchBaseRef } = trpc.diff.fetchBase.useMutation({
    onSettled: () => setBaseFetched(true),
  });
  const fetchStarted = useRef(false);
  useEffect(() => {
    if (fetchStarted.current) return;
    fetchStarted.current = true;
    fetchBaseRef({ repoDir: repoPath, worktreePath, base });
  }, [fetchBaseRef, repoPath, worktreePath, base]);

  const {
    data: branchDiff,
    isLoading: isDiffLoading,
    error: diffError,
    refetch: refetchDiff,
  } = trpc.diff.getBranchDiff.useQuery(
    { repoDir: repoPath, worktreePath, base, compareTo: 'head' },
    { enabled: baseFetched, retry: false },
  );

  const { data: gitattributes } = trpc.file.read.useQuery(
    { repoDir: repoPath, worktreePath, filePath: '.gitattributes' },
    { retry: false },
  );

  const classes = useMemo(
    () =>
      classifyPaths(
        (branchDiff?.files ?? []).map((file) => file.path),
        parseGitattributes(gitattributes?.content ?? ''),
      ),
    [branchDiff, gitattributes],
  );
  const files = useMemo(
    () => orderByClass(branchDiff?.files ?? [], classes),
    [branchDiff, classes],
  );

  const source: DiffSource = useMemo(
    () => ({ diffViewMode: 'branch', branchTarget: 'head', selectedCommit: null, branchDiff }),
    [branchDiff],
  );

  const patchSpec = useMemo(() => patchSpecFor({ ...source, selectedSide: null }), [source]);
  const nonImplementation = useMemo(
    () => files.filter((file) => classes.get(file.path) !== 'implementation'),
    [files, classes],
  );
  const patchQueries = trpc.useQueries((t) =>
    nonImplementation.map((file) =>
      t.diff.getPatch(
        {
          repoDir: repoPath,
          worktreePath,
          filePath: file.path,
          oldPath: file.oldPath,
          spec: patchSpec ?? { kind: 'unstaged' },
          contentId: patchSpec ? patchContentId(patchSpec, file) : undefined,
        },
        { enabled: !!patchSpec && lineMode === 'implementation', retry: false },
      ),
    ),
  );

  const lines = useMemo(() => {
    if (lineMode === 'total') return totalLines;
    if (!patchSpec) return null;
    return implementationLinesFromPatches(totalLines, patchQueries);
  }, [lineMode, totalLines, patchSpec, patchQueries]);

  if (diffError) {
    return (
      <ReviewErrorMessage
        title="Could not load the diff"
        message={diffError.message}
        onRetry={() => refetchDiff()}
      />
    );
  }

  return (
    <ReviewWriteProvider value={reviewWrite}>
      <DiffReviewSurface
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workspaceId={workspaceId}
        repoDir={repoPath}
        worktreePath={worktreePath}
        source={source}
        files={files}
        isFilesLoading={!baseFetched || isDiffLoading}
        commentBranchKey={headRefName}
        correlatedBranch={headRefName}
        viewedBase={base}
        tabs={tabs}
        subToolbar={<LineCountBar lines={lines} mode={lineMode} onModeChange={setLineMode} />}
        fileClasses={classes}
        showOutdatedThreads
        reviewKeys={active}
        hideAgentReview
      />
    </ReviewWriteProvider>
  );
}
