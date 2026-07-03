'use client';

import { useRef, useState } from 'react';
import { RiDeleteBinLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  collectDirPaths,
  ConfirmCreateDirsDialog,
  useConfirmCreateDirs,
} from '@/components/confirm-create-dirs';
import { DirPathInput } from '@/components/dir-path-input';
import { RepoPathsField } from '@/components/repo-paths-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listAgentTypes, coerceAgentTypeId, type AgentTypeId } from '@/lib/agent-types';
import {
  ContainerSettings,
  type ContainerSettingsData,
} from '@/components/workspace/container-settings';
import type { ContainerConfig, CoderConfig, ExecutionBackend } from '@/server/db/schema';

interface EditWorkspaceDialogProps {
  workspace: {
    id: number;
    name: string;
    slug: string;
    repos: string[] | null;
    docsDir: string | null;
    splitWorktrees: boolean | null;
    planSkill: string | null;
    implementSkill: string | null;
    defaultAgentType: string | null;
    containerEnabled: boolean | null;
    containerConfig: ContainerConfig | null;
    executionBackend: ExecutionBackend | null;
    coderConfig: CoderConfig | null;
    remoteEnabled: boolean | null;
    maxConcurrency: number | null;
    autoStart: boolean | null;
    autoAgentCompletion: 'pr' | 'merge' | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (newSlug: string) => void;
  onDeleted?: () => void;
}

function initialRepos(repos: string[] | null): string[] {
  return repos && repos.length > 0 ? repos : [''];
}

export function EditWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: EditWorkspaceDialogProps) {
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [docsDir, setDocsDir] = useState(workspace.docsDir ?? '');
  const [repos, setRepos] = useState<string[]>(initialRepos(workspace.repos));
  const [splitWorktrees, setSplitWorktrees] = useState(workspace.splitWorktrees ?? false);
  const [planSkill, setPlanSkill] = useState(workspace.planSkill ?? '');
  const [implementSkill, setImplementSkill] = useState(workspace.implementSkill ?? '');
  const [defaultAgentType, setDefaultAgentType] = useState<AgentTypeId>(
    coerceAgentTypeId(workspace.defaultAgentType),
  );
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const containerDataRef = useRef<ContainerSettingsData>({
    containerEnabled: workspace.containerEnabled ?? false,
    containerConfig: workspace.containerConfig ?? {},
    executionBackend: workspace.executionBackend ?? 'devcontainer',
    coderConfig: workspace.coderConfig ?? undefined,
    remoteEnabled: workspace.remoteEnabled ?? false,
    maxConcurrency: workspace.maxConcurrency ?? 1,
    autoStart: workspace.autoStart ?? false,
    autoAgentCompletion: workspace.autoAgentCompletion ?? 'pr',
  });

  const utils = trpc.useUtils();
  const deleteMutation = trpc.workspace.delete.useMutation({
    onSuccess: () => {
      utils.workspace.list.invalidate();
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = trpc.workspace.update.useMutation({
    onSuccess: () => {
      onSaved(slug);
      onOpenChange(false);
    },
    onError: (err) => setError(err.message),
  });

  const confirmDirs = useConfirmCreateDirs({ mutate, onError: setError });

  function mutate(createMissingDirs: boolean) {
    const filteredRepos = repos.map((r) => r.trim()).filter((r) => r !== '');
    const trimmedDocsDir = docsDir.trim();
    const container = containerDataRef.current;
    updateMutation.mutate({
      id: workspace.id,
      name,
      slug: slug !== workspace.slug ? slug : undefined,
      repos: filteredRepos,
      docsDir: trimmedDocsDir || null,
      splitWorktrees,
      planSkill: planSkill.trim() || null,
      implementSkill: implementSkill.trim() || null,
      defaultAgentType,
      containerEnabled: container.containerEnabled,
      containerConfig: container.containerConfig,
      executionBackend: container.executionBackend,
      coderConfig: container.coderConfig,
      remoteEnabled: container.remoteEnabled,
      maxConcurrency: container.maxConcurrency,
      autoStart: container.autoStart,
      autoAgentCompletion: container.autoAgentCompletion,
      ...(createMissingDirs ? { createMissingDirs: true } : {}),
    });
  }

  const nameValidationError = /[/\\]/.test(name)
    ? 'Name must not contain path separators (/ or \\)'
    : null;
  const slugValidationError = slug && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)
    ? 'Slug must contain only lowercase letters, numbers, and hyphens'
    : null;
  const hasValidationError = !!nameValidationError || !!slugValidationError;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (hasValidationError) return;
    setError(null);
    void confirmDirs.submit(collectDirPaths(repos, docsDir));
  }

  const pending = updateMutation.isPending || confirmDirs.validating;

  // Combined worktrees is unavailable when docs sit inside a repo (content would
  // be worktree-dependent), so split is forced on. Mirror the server's
  // containment check with a simple path-prefix test (no node:path on client).
  const docsInsideRepo = (() => {
    const docs = docsDir.trim().replace(/\/+$/, '');
    if (!docs) return false;
    return repos
      .map((r) => r.trim().replace(/\/+$/, ''))
      .filter((r) => r !== '')
      .some((repo) => docs === repo || docs.startsWith(repo + '/'));
  })();

  function deriveSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function handleNameChange(newName: string) {
    setName(newName);
    if (!slugTouched) {
      setSlug(deriveSlug(newName));
    }
  }

  function handleOpenChange(val: boolean) {
    if (!val) {
      setName(workspace.name);
      setSlug(workspace.slug);
      setSlugTouched(false);
      setDocsDir(workspace.docsDir ?? '');
      setRepos(initialRepos(workspace.repos));
      setSplitWorktrees(workspace.splitWorktrees ?? false);
      setPlanSkill(workspace.planSkill ?? '');
      setImplementSkill(workspace.implementSkill ?? '');
      setDefaultAgentType(coerceAgentTypeId(workspace.defaultAgentType));
      setError(null);
      setDeleteConfirmOpen(false);
      confirmDirs.reset();
      containerDataRef.current = {
        containerEnabled: workspace.containerEnabled ?? false,
        containerConfig: workspace.containerConfig ?? {},
        executionBackend: workspace.executionBackend ?? 'devcontainer',
        coderConfig: workspace.coderConfig ?? undefined,
        remoteEnabled: workspace.remoteEnabled ?? false,
        maxConcurrency: workspace.maxConcurrency ?? 1,
        autoStart: workspace.autoStart ?? false,
        autoAgentCompletion: workspace.autoAgentCompletion ?? 'pr',
      };
    }
    onOpenChange(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Workspace</DialogTitle>
            <DialogDescription>Update workspace settings.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="general" className="flex flex-col gap-2 py-4">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="container">Container</TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <div className="flex flex-col gap-4 pt-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-workspace-name">Name</Label>
                  <Input
                    id="edit-workspace-name"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    required
                  />
                  {nameValidationError && (
                    <p className="text-xs text-destructive">{nameValidationError}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-workspace-slug">Slug</Label>
                  <Input
                    id="edit-workspace-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugTouched(true);
                    }}
                    className="font-mono"
                    required
                  />
                  {slugValidationError ? (
                    <p className="text-xs text-destructive">{slugValidationError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Used in the URL: /w/{slug || '...'}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-workspace-docs-dir">Docs location</Label>
                  <DirPathInput
                    id="edit-workspace-docs-dir"
                    variant="dropdown"
                    value={docsDir}
                    onChange={setDocsDir}
                    placeholder="/path/to/docs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the default Engy data directory.
                  </p>
                </div>
                <RepoPathsField repos={repos} onChange={setRepos} />
                {repos.some((r) => r.trim() !== '') && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="edit-workspace-split-worktrees">Split worktrees</Label>
                      <Switch
                        id="edit-workspace-split-worktrees"
                        checked={splitWorktrees || docsInsideRepo}
                        disabled={docsInsideRepo}
                        onCheckedChange={setSplitWorktrees}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {docsInsideRepo
                        ? 'Forced on — the docs directory lives inside a repo, so each worktree needs its own project view.'
                        : 'Off (default): all worktrees share one project view; terminals are grouped by worktree. On: one project tab per worktree, like before.'}
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-workspace-default-agent">Default agent</Label>
                  <p className="text-xs text-muted-foreground">
                    Agent CLI new terminals launch by default. Pick a different one per terminal
                    from the New Terminal menu.
                  </p>
                  <Select
                    value={defaultAgentType}
                    onValueChange={(value: AgentTypeId) => setDefaultAgentType(value)}
                  >
                    <SelectTrigger id="edit-workspace-default-agent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {listAgentTypes().map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Task skills</Label>
                  <p className="text-xs text-muted-foreground">
                    Slash commands invoked by the Plan/Implement buttons.
                  </p>
                  <Input
                    aria-label="Plan skill"
                    value={planSkill}
                    onChange={(e) => setPlanSkill(e.target.value)}
                    placeholder="/engy:plan (plan)"
                  />
                  <Input
                    aria-label="Implement skill"
                    value={implementSkill}
                    onChange={(e) => setImplementSkill(e.target.value)}
                    placeholder="/engy:implement (implement)"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="container">
              <ContainerSettings
                initialData={{
                  containerEnabled: workspace.containerEnabled ?? false,
                  containerConfig: workspace.containerConfig ?? {},
                  executionBackend: workspace.executionBackend ?? 'devcontainer',
                  coderConfig: workspace.coderConfig ?? undefined,
                  remoteEnabled: workspace.remoteEnabled ?? false,
                  maxConcurrency: workspace.maxConcurrency ?? 1,
                  autoStart: workspace.autoStart ?? false,
                  autoAgentCompletion: workspace.autoAgentCompletion ?? 'pr',
                }}
                onChange={(data) => {
                  containerDataRef.current = data;
                }}
              />
            </TabsContent>
          </Tabs>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-between pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <RiDeleteBinLine data-icon="inline-start" />
              Delete workspace
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || hasValidationError}>
              {pending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>

      <ConfirmCreateDirsDialog
        dirs={confirmDirs.dirsToCreate}
        actionLabel="Create and save"
        onConfirm={confirmDirs.confirm}
        onCancel={confirmDirs.cancel}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{workspace.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this workspace and all its projects, tasks, and data.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate({ id: workspace.id });
              }}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
