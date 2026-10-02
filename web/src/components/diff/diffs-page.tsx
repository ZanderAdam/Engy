'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { trpc } from '@/lib/trpc';
import { ViewModeTabs } from './view-mode-tabs';
import { CommitList } from './commit-list';
import { RepoSelector } from './repo-selector';
import { WorktreeSelector } from './worktree-selector';
import type { WorktreeSelection } from './worktree-selector';
import { DiffReviewSurface, type DiffSource } from './diff-review-surface';
import { viewedBaseFor } from './viewed-base';
import { refreshDiff } from './diff-refresh';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import {
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { diffUrlParams } from './diff-url-params';
import { worktreeForBranch } from './link-target';
import { repoDirByName } from '@/lib/repo-name';
import { RiGitBranchLine, RiDownloadLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useEditorTabs } from '@/components/editor/use-editor-tabs';
import type { BranchDiffTarget } from '@engy/common';
import type { ChangedFile, DiffViewMode } from './types';

// `worktree` keeps uncommitted work visible; `head` reproduces the pull request.
const BRANCH_TARGETS: Array<{ value: BranchDiffTarget; label: string; hint: string }> = [
  {
    value: 'worktree',
    label: 'Working tree',
    hint: 'Fork point vs. your working tree — includes uncommitted edits and untracked files',
  },
  {
    value: 'head',
    label: 'PR',
    hint: 'Fork point vs. your last commit — exactly what the GitHub pull request shows',
  },
];

interface DiffsPageProps {
  workspaceSlug: string;
  projectSlug: string;
}

export function DiffsPage({ workspaceSlug, projectSlug }: DiffsPageProps) {
  // Open-file tabs: multiple diffs can be open at once, mirroring the Code screen.
  // Every view-mode / repo / commit switch resets the set (the remembered paths
  // belong to a specific changed-files list), so open tabs are always drawn from
  // the current `files`.
  const tabs = useEditorTabs();

  const search = useVirtualSearchParams();
  const pathname = useVirtualPathname();
  const navigate = useVirtualNavigate();
  const { repo: repoParam, branch: branchParam, view: viewParam } = diffUrlParams(search);

  // Steering by hand drops the link's params, so clicking the same Diff link
  // again is a change the page can see and act on.
  const forgetLinkParams = () => {
    if (!repoParam && !branchParam) return;
    const next = new URLSearchParams(search.toString());
    next.delete('diffRepo');
    next.delete('diffBranch');
    const query = next.toString();
    navigate.push(query ? `${pathname}?${query}` : pathname);
  };

  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>(viewParam ?? 'latest');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  // null = follow the repo's detected default branch; a string is an explicit override.
  const [userBaseBranch, setUserBaseBranch] = useState<string | null>(null);
  const [branchTarget, setBranchTarget] = useState<BranchDiffTarget>('worktree');
  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(null);
  // What the incoming link asked for, by the names the two dropdowns use. Held
  // until the reader picks something themselves: the repo list and the worktree
  // list both arrive after the first render, so neither can be resolved here.
  const [linkRepoName, setLinkRepoName] = useState<string | null>(repoParam);
  const [linkBranch, setLinkBranch] = useState<string | null>(branchParam);
  const [userSelectedWorktree, setUserSelectedWorktree] = useState<WorktreeSelection>(null);

  const handleUserWorktreeChange = (worktree: WorktreeSelection) => {
    forgetLinkParams();
    setLinkBranch(null);
    setUserSelectedWorktree(worktree);
    tabs.reset();
    setSelectedCommit(null);
  };

  // The link can retarget a tab that already shows this page, which stays
  // mounted, so the params are synced during render rather than only read once.
  const paramKey = `${repoParam ?? ''}|${branchParam ?? ''}|${viewParam ?? ''}`;
  const [prevParamKey, setPrevParamKey] = useState(paramKey);
  if (paramKey !== prevParamKey) {
    setPrevParamKey(paramKey);
    if (repoParam) setLinkRepoName(repoParam);
    if (branchParam) setLinkBranch(branchParam);
    if (viewParam) setDiffViewMode(viewParam);
    tabs.reset();
    setSelectedCommit(null);
  }

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug },
    { enabled: !!workspace },
  );

  const { branch: projectWorktreeBranch, repoMap: projectRepoMap } = useProjectWorktreeMap({
    projectId: project?.id,
    combined: workspace?.combinedWorktrees,
  });

  // When a project-level worktree activates, drop any local per-repo worktree
  // selection so clearing `?wt` later doesn't resurrect a stale Coder pick.
  // Using the "set state during render" pattern (vs. useEffect) per React's
  // recommendation for state synced to props.
  const [prevProjectWtBranch, setPrevProjectWtBranch] = useState<string | null>(
    projectWorktreeBranch,
  );
  if (projectWorktreeBranch !== prevProjectWtBranch) {
    setPrevProjectWtBranch(projectWorktreeBranch);
    if (projectWorktreeBranch) setUserSelectedWorktree(null);
  }
  const { data: taskGroups } = trpc.taskGroup.list.useQuery(
    { projectId: project?.id ?? 0 },
    { enabled: !!project },
  );

  const allRepos = useMemo(() => {
    const repoSet = new Set<string>();
    if (taskGroups) {
      for (const group of taskGroups) {
        const repos = group.repos as string[] | null;
        if (repos) repos.forEach((r) => repoSet.add(r));
      }
    }
    if (workspace) {
      const repos = workspace.repos as string[] | null;
      if (repos) repos.forEach((r) => repoSet.add(r));
    }
    if (project?.projectDir) repoSet.add(project.projectDir);
    return [...repoSet];
  }, [workspace, taskGroups, project]);

  const linkRepo = linkRepoName ? repoDirByName(allRepos, linkRepoName) : null;
  const selectedRepo = linkRepo ?? userSelectedRepo ?? (allRepos.length > 0 ? allRepos[0] : null);

  // The same list the worktree dropdown offers, so a link naming a branch
  // lands on exactly the entry the reader would have picked by hand.
  const { data: repoWorktrees } = trpc.diff.getWorktrees.useQuery(
    { workspaceSlug, repoDir: selectedRepo! },
    { enabled: !!selectedRepo && !!linkBranch },
  );
  const linkWorktree = useMemo(
    () => worktreeForBranch(repoWorktrees, linkBranch),
    [repoWorktrees, linkBranch],
  );

  // When a project-level worktree is active, derive selectedWorktree from the
  // per-repo map (overrides the user's local WorktreeSelector choice).
  const selectedWorktree: WorktreeSelection = useMemo(() => {
    if (linkWorktree !== undefined) return linkWorktree;
    if (projectWorktreeBranch && selectedRepo) {
      const worktreePath = projectRepoMap.get(selectedRepo);
      if (worktreePath) return { worktreePath };
      return null;
    }
    return userSelectedWorktree;
  }, [linkWorktree, projectWorktreeBranch, projectRepoMap, selectedRepo, userSelectedWorktree]);

  const handleRepoChange = (repo: string) => {
    forgetLinkParams();
    setLinkRepoName(null);
    setLinkBranch(null);
    setUserSelectedRepo(repo);
    tabs.reset();
    setSelectedCommit(null);
    setUserSelectedWorktree(null);
    setUserBaseBranch(null);
    fetchBase.reset();
  };

  const handleDiffViewModeChange = (mode: DiffViewMode) => {
    setDiffViewMode(mode);
    tabs.reset();
    setSelectedCommit(null);
  };

  // Latest changes data. Uncommitted work changes under the reviewer while they
  // read it, so this list opts out of the app-wide staleness window and reloads
  // whenever attention comes back to the browser — every content read downstream
  // is keyed on identities it reports.
  const { data: statusData, isLoading: isStatusLoading } = trpc.diff.getStatus.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    {
      enabled: !!selectedRepo && diffViewMode === 'latest',
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  );

  // Comment threads are keyed by the branch under review, so the branch is read
  // in every view mode — not only the one that lists working-tree files.
  const { data: branchData } = trpc.diff.getBranch.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
      forComments: true,
    },
    { enabled: !!selectedRepo },
  );
  const checkedOutBranch = branchData?.branch ?? null;

  const { data: logData, isLoading: isLogLoading } = trpc.diff.getLog.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'history' },
  );

  const {
    data: commitDiffData,
    isLoading: isCommitDiffLoading,
    error: commitDiffError,
  } = trpc.diff.getCommitDiff.useQuery(
    {
      repoDir: selectedRepo!,
      commitHash: selectedCommit!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && !!selectedCommit && diffViewMode === 'history' },
  );

  // Default base branch, detected per repo by the daemon (origin/HEAD, then
  // well-known names). The text input overrides it.
  const {
    data: defaultBaseData,
    isLoading: isDefaultBaseLoading,
    error: defaultBaseError,
  } = trpc.diff.getDefaultBase.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'branch', retry: false },
  );

  const baseBranch = userBaseBranch ?? defaultBaseData?.base ?? '';

  // Engy never fetches on its own, so a stale remote-tracking ref would silently
  // move the fork point away from what the pull request compares against.
  const utils = trpc.useUtils();
  const fetchBase = trpc.diff.fetchBase.useMutation({
    onSuccess: () => {
      void utils.diff.getBranchDiff.invalidate();
      void utils.diff.getDefaultBase.invalidate();
    },
  });

  const handleRefresh = useCallback(() => refreshDiff(utils), [utils]);

  const {
    data: branchDiffData,
    isLoading: isBranchLoading,
    error: branchError,
  } = trpc.diff.getBranchDiff.useQuery(
    {
      repoDir: selectedRepo!,
      base: baseBranch,
      compareTo: branchTarget,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'branch' && baseBranch.length > 0, retry: false },
  );

  const files: ChangedFile[] = useMemo(() => {
    if (diffViewMode === 'latest') return statusData?.files ?? [];
    if (diffViewMode === 'history' && commitDiffData) {
      return commitDiffData.files.map((f) => ({ ...f, staged: false }));
    }
    if (diffViewMode === 'branch' && branchDiffData) {
      return branchDiffData.files.map((f) => ({ ...f, staged: false }));
    }
    return [];
  }, [diffViewMode, statusData, commitDiffData, branchDiffData]);

  const source: DiffSource = useMemo(
    () => ({
      diffViewMode,
      head: statusData?.head,
      selectedCommit,
      branchTarget,
      branchDiff: branchDiffData,
    }),
    [diffViewMode, statusData, selectedCommit, branchTarget, branchDiffData],
  );

  const isFileListLoading =
    (diffViewMode === 'latest' && isStatusLoading) ||
    (diffViewMode === 'history' && isCommitDiffLoading) ||
    // Detecting the default base blocks the branch diff, so count it as loading
    // rather than letting the panel claim there are no changes.
    (diffViewMode === 'branch' && (isBranchLoading || isDefaultBaseLoading));

  const toolbarLeading = (
    <>
      <ViewModeTabs value={diffViewMode} onChange={handleDiffViewModeChange} />
      <RepoSelector
        repos={allRepos}
        selectedRepo={selectedRepo ?? ''}
        onSelectRepo={handleRepoChange}
      />
      {selectedRepo && !projectWorktreeBranch && (
        <WorktreeSelector
          workspaceSlug={workspaceSlug}
          repoDir={selectedRepo}
          value={selectedWorktree}
          onChange={handleUserWorktreeChange}
        />
      )}
      {projectWorktreeBranch && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <RiGitBranchLine className="size-3" />
          <span>on</span>
          <span className="font-mono text-foreground">{projectWorktreeBranch}</span>
        </div>
      )}
    </>
  );

  const branchControls = diffViewMode === 'branch' && (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
      <span className="text-xs text-muted-foreground">Base:</span>
      <input
        type="text"
        value={baseBranch}
        onChange={(e) => {
          setUserBaseBranch(e.target.value);
          // Feedback belongs to the ref that was fetched, not the new one.
          fetchBase.reset();
        }}
        className="h-6 border border-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:border-ring"
        placeholder={defaultBaseData?.base ?? 'origin/main'}
      />
      {userBaseBranch !== null && defaultBaseData && userBaseBranch !== defaultBaseData.base && (
        <button
          type="button"
          onClick={() => setUserBaseBranch(null)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          reset to {defaultBaseData.base}
        </button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => fetchBase.mutate({ repoDir: selectedRepo!, base: baseBranch })}
            disabled={!selectedRepo || !baseBranch || fetchBase.isPending}
            className="h-6 w-6 shrink-0 p-0"
          >
            <RiDownloadLine className={cn('size-3.5', fetchBase.isPending && 'animate-pulse')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Fetch the base branch, so the fork point matches the remote
        </TooltipContent>
      </Tooltip>

      <div className="flex shrink-0">
        {BRANCH_TARGETS.map(({ value, label, hint }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setBranchTarget(value)}
                className={cn(branchTarget === value && 'bg-muted text-foreground')}
              >
                {label}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {branchDiffData?.mergeBase && (
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          forked at{' '}
          <span className="font-mono text-foreground">{branchDiffData.mergeBase.slice(0, 7)}</span>
        </span>
      )}

      {branchError && (
        <span className="text-xs text-destructive">
          {branchError.message.replace(/^.*Invalid base ref/, 'Invalid ref')}
        </span>
      )}
      {defaultBaseError && !userBaseBranch && (
        <span className="text-xs text-destructive">
          Could not detect the default branch — enter a base ref above.
        </span>
      )}
      {fetchBase.isSuccess && !fetchBase.data?.remote && (
        <span className="text-xs text-muted-foreground">No remote to fetch for this base.</span>
      )}
      {fetchBase.error && (
        <span className="text-xs text-destructive">Fetch failed: {fetchBase.error.message}</span>
      )}
    </div>
  );

  const wrapFileList =
    diffViewMode === 'history'
      ? (fileList: ReactNode) => (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <CommitList
                commits={logData?.commits ?? []}
                selectedHash={selectedCommit}
                onSelectCommit={(hash) => {
                  setSelectedCommit(hash);
                  tabs.reset();
                }}
                isLoading={isLogLoading}
              />
            </div>
            {selectedCommit && (
              <div className="flex-1 min-h-0 border-t border-border overflow-auto">
                {commitDiffError ? (
                  <div className="space-y-2 px-3 py-2">
                    <p className="text-xs text-destructive">
                      Failed to load commit changes: {commitDiffError.message}
                    </p>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      className="border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  fileList
                )}
              </div>
            )}
          </div>
        )
      : undefined;

  return (
    <DiffReviewSurface
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      workspaceId={workspace?.id}
      repoDir={selectedRepo}
      worktreePath={selectedWorktree?.worktreePath}
      coderWorkspace={selectedWorktree?.coderWorkspace}
      source={source}
      files={files}
      isFilesLoading={isFileListLoading}
      commentBranchKey={checkedOutBranch}
      correlatedBranch={projectWorktreeBranch}
      viewedBase={viewedBaseFor(diffViewMode, baseBranch, selectedCommit)}
      tabs={tabs}
      toolbarLeading={toolbarLeading}
      subToolbar={branchControls}
      wrapFileList={wrapFileList}
    />
  );
}
