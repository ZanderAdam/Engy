'use client';

import { useMemo, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiRefreshLine, RiArrowLeftLine } from '@remixicon/react';
import {
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

interface ManageWorktreesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workspaceRepos: string[];
}

type Mode = 'list' | 'create';

type FinalRepoResult = { repoPath: string; success: boolean; code?: string; error?: string };

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

export function ManageWorktreesDialog({
  open,
  onOpenChange,
  projectId,
  workspaceRepos,
}: ManageWorktreesDialogProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [error, setError] = useState<string | null>(null);
  const [dirtyPending, setDirtyPending] = useState<{
    branch: string;
    repoPaths: string[];
    finalByRepo: Map<string, FinalRepoResult>;
  } | null>(null);

  const utils = trpc.useUtils();
  const { data: listGroupedData } = trpc.worktree.listGrouped.useQuery(
    { projectId },
    { enabled: open },
  );
  const groups = listGroupedData?.groups ?? [];

  const searchParams = useVirtualSearchParams();
  const pathname = useVirtualPathname();
  const navigate = useVirtualNavigate();
  const activeBranch = searchParams.get('wt');

  function setUrlBranch(branch: string | null) {
    const next = new URLSearchParams(searchParams);
    if (branch === null) next.delete('wt');
    else next.set('wt', branch);
    const qs = next.toString();
    navigate.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const syncMut = trpc.worktree.sync.useMutation({
    onSuccess: () => {
      utils.worktree.listGrouped.invalidate({ projectId });
    },
  });
  const removeMut = trpc.worktree.remove.useMutation({
    onSuccess: () => {
      utils.worktree.listGrouped.invalidate({ projectId });
    },
  });
  const createMut = trpc.worktree.create.useMutation({
    onSuccess: (result) => {
      utils.worktree.listGrouped.invalidate({ projectId });
      setUrlBranch(result.branch);
      onOpenChange(false);
    },
  });

  async function handleSync(branch: string, missingRepos: string[]) {
    setError(null);
    try {
      const result = await syncMut.mutateAsync({ projectId, branch, repoPaths: missingRepos });
      const failed = result.filter(
        (r): r is Extract<(typeof result)[number], { success: false }> => !r.success,
      );
      if (failed.length > 0) {
        const detail = failed
          .map((f) => `${basename(f.repoPath)}: ${f.error}`)
          .join('; ');
        setError(`Sync failed — ${detail}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove(branch: string, presentRepos: string[]) {
    setError(null);
    try {
      const result = await removeMut.mutateAsync({
        projectId,
        branch,
        repoPaths: presentRepos,
        force: false,
      });

      const finalByRepo = new Map(result.map((r) => [r.repoPath, r]));
      const dirty = result.filter((r) => !r.success && r.code === 'DIRTY');

      if (dirty.length > 0) {
        setDirtyPending({
          branch,
          repoPaths: dirty.map((d) => d.repoPath),
          finalByRepo,
        });
        return;
      }

      finishRemove(branch, finalByRepo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleForceConfirm() {
    if (!dirtyPending) return;
    const { branch, repoPaths, finalByRepo } = dirtyPending;
    setDirtyPending(null);
    try {
      const forced = await removeMut.mutateAsync({
        projectId,
        branch,
        repoPaths,
        force: true,
      });
      for (const r of forced) {
        finalByRepo.set(r.repoPath, r);
      }
      finishRemove(branch, finalByRepo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function finishRemove(branch: string, finalByRepo: Map<string, FinalRepoResult>) {
    const failures = [...finalByRepo.values()].filter((r) => !r.success);
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `${basename(f.repoPath)}: ${f.error ?? 'unknown error'}`)
        .join('; ');
      setError(`Remove failed — ${detail}`);
      return;
    }
    if (branch === activeBranch) setUrlBranch(null);
  }

  return (
    <>
    <AlertDialog open={!!dirtyPending} onOpenChange={(o) => { if (!o) setDirtyPending(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Uncommitted changes</AlertDialogTitle>
          <AlertDialogDescription>
            {dirtyPending?.repoPaths.length ?? 0} worktree(s) have uncommitted changes. Force
            remove will discard all local changes. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDirtyPending(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleForceConfirm}>Force remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'list' ? 'Worktrees' : 'Create worktree'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'list'
              ? 'Manage git worktrees across the workspace repos for this project.'
              : 'Create a new worktree branch across the selected repos.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {mode === 'list' ? (
          <ListMode
            groups={groups}
            workspaceRepos={workspaceRepos}
            isBusy={syncMut.isPending || removeMut.isPending}
            onSync={handleSync}
            onRemove={handleRemove}
          />
        ) : (
          <CreateMode
            workspaceRepos={workspaceRepos}
            isBusy={createMut.isPending}
            onCancel={() => setMode('list')}
            onCreate={(input) => createMut.mutate({ projectId, ...input })}
            createError={
              createMut.error?.message ?? null
            }
          />
        )}

        <DialogFooter className="sm:justify-between">
          {mode === 'list' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button size="sm" onClick={() => setMode('create')}>
                <RiAddLine className="mr-1 size-3" />
                New worktree
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setMode('list')}>
              <RiArrowLeftLine className="mr-1 size-3" />
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

interface ListModeProps {
  groups: Array<{ branch: string; repos: Array<{ repoPath: string; worktreePath: string }> }>;
  workspaceRepos: string[];
  isBusy: boolean;
  onSync: (branch: string, missing: string[]) => void;
  onRemove: (branch: string, present: string[]) => void;
}

function ListMode({ groups, workspaceRepos, isBusy, onSync, onRemove }: ListModeProps) {
  if (groups.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No worktrees yet. Click &ldquo;New worktree&rdquo; to create one.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto">
      {groups.map((g) => {
        const presentRepoSet = new Set(g.repos.map((r) => r.repoPath));
        const missing = workspaceRepos.filter((r) => !presentRepoSet.has(r));
        const fullyMaterialized = missing.length === 0;
        return (
          <div
            key={g.branch}
            className="flex items-center gap-2 border border-border px-3 py-2"
          >
            <span className="font-mono text-xs flex-1 truncate">{g.branch}</span>
            <span
              className={cn(
                'text-[10px] tabular-nums',
                fullyMaterialized ? 'text-muted-foreground' : 'text-amber-500',
              )}
            >
              {g.repos.length}/{workspaceRepos.length}
            </span>
            <div className="flex gap-1">
              {workspaceRepos.map((repo) => (
                <span
                  key={repo}
                  title={repo}
                  className={cn(
                    'inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]',
                    presentRepoSet.has(repo)
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-muted text-muted-foreground/40',
                  )}
                >
                  {presentRepoSet.has(repo) ? '✓' : '○'}
                </span>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy || fullyMaterialized}
              onClick={() => onSync(g.branch, missing)}
              className="h-6 px-1.5"
            >
              <RiRefreshLine className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => onRemove(g.branch, g.repos.map((r) => r.repoPath))}
              className="h-6 px-1.5 text-destructive"
            >
              <RiDeleteBinLine className="size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

interface CreateModeProps {
  workspaceRepos: string[];
  isBusy: boolean;
  onCancel: () => void;
  onCreate: (input: {
    branch: string;
    baseRef?: string;
    repoPaths: string[];
    createBranch: boolean;
  }) => void;
  createError: string | null;
}

function CreateMode({ workspaceRepos, isBusy, onCancel, onCreate, createError }: CreateModeProps) {
  const [branch, setBranch] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [createBranch, setCreateBranch] = useState(true);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set(workspaceRepos));

  const canSubmit = useMemo(
    () => branch.trim().length > 0 && selectedRepos.size > 0 && !isBusy,
    [branch, selectedRepos, isBusy],
  );

  function toggleRepo(repo: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }

  function submit() {
    if (!canSubmit) return;
    onCreate({
      branch: branch.trim(),
      baseRef: baseRef.trim() || undefined,
      repoPaths: [...selectedRepos],
      createBranch,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Branch name</span>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feat-x"
          className="border border-input bg-background px-2 py-1 font-mono text-xs"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={createBranch}
          onChange={(e) => setCreateBranch(e.target.checked)}
        />
        <span>Create new branch (uncheck to check out an existing branch)</span>
      </label>
      {createBranch && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Base ref (optional)</span>
          <input
            type="text"
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            placeholder="main"
            className="border border-input bg-background px-2 py-1 font-mono text-xs"
          />
        </label>
      )}
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Repositories</span>
        {workspaceRepos.map((repo) => (
          <label key={repo} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedRepos.has(repo)}
              onChange={() => toggleRepo(repo)}
            />
            <span className="font-mono truncate">{basename(repo)}</span>
            <span className="text-muted-foreground/60 text-[10px] truncate">{repo}</span>
          </label>
        ))}
      </div>
      {createError && (
        <p className="text-xs text-destructive" role="alert">
          {createError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!canSubmit}>
          {isBusy ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
