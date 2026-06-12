'use client';

import { useState } from 'react';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { RiAddLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

export function CreateWorkspaceDialog() {
  const nav = useVirtualNavigate();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [docsDir, setDocsDir] = useState('');
  const [repos, setRepos] = useState<string[]>(['']);
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.workspace.create.useMutation({
    onSuccess: (workspace) => {
      utils.workspace.list.invalidate();
      setOpen(false);
      resetForm();
      nav.push(`/w/${workspace.slug}`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const confirmDirs = useConfirmCreateDirs({ mutate, onError: setError });

  function resetForm() {
    setName('');
    setDocsDir('');
    setRepos(['']);
    setError(null);
    confirmDirs.reset();
  }

  function mutate(createMissingDirs: boolean) {
    const filteredRepos = repos.map((r) => r.trim()).filter((r) => r !== '');
    const trimmedDocsDir = docsDir.trim();
    createMutation.mutate({
      name,
      repos: filteredRepos,
      ...(trimmedDocsDir ? { docsDir: trimmedDocsDir } : {}),
      ...(createMissingDirs ? { createMissingDirs: true } : {}),
    });
  }

  const nameError = /[/\\]/.test(name) ? 'Name must not contain path separators (/ or \\)' : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nameError) return;
    setError(null);
    void confirmDirs.submit(collectDirPaths(repos, docsDir));
  }

  const pending = createMutation.isPending || confirmDirs.validating;

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RiAddLine data-icon="inline-start" />
          New Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
            <DialogDescription>Create a workspace to organize your projects.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-workspace"
                required
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-docs-dir">Docs location (optional)</Label>
              <DirPathInput
                id="workspace-docs-dir"
                variant="dropdown"
                value={docsDir}
                onChange={setDocsDir}
                placeholder="/path/to/docs"
              />
              <p className="text-xs text-muted-foreground">
                Custom path for workspace files. Defaults to Engy data directory.
              </p>
            </div>
            <RepoPathsField repos={repos} onChange={setRepos} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim() || !!nameError}>
              {pending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>

        <ConfirmCreateDirsDialog
          dirs={confirmDirs.dirsToCreate}
          actionLabel="Create and continue"
          onConfirm={confirmDirs.confirm}
          onCancel={confirmDirs.cancel}
        />
      </DialogContent>
    </Dialog>
  );
}
