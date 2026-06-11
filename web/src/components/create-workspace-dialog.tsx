'use client';

import { useState } from 'react';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
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

  function addRepo() {
    setRepos([...repos, '']);
  }

  function removeRepo(index: number) {
    setRepos(repos.filter((_, i) => i !== index));
  }

  function updateRepo(index: number, value: string) {
    const updated = [...repos];
    updated[index] = value;
    setRepos(updated);
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
            <div className="flex flex-col gap-2">
              <Label>Repository paths</Label>
              {repos.map((repo, i) => (
                <div key={i} className="flex gap-2">
                  <DirPathInput
                    className="flex-1"
                    variant="dropdown"
                    value={repo}
                    onChange={(value) => updateRepo(i, value)}
                    placeholder="/path/to/repo"
                  />
                  {repos.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove path ${i + 1}`}
                      onClick={() => removeRepo(i)}
                    >
                      <RiCloseLine />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={addRepo}>
                <RiAddLine data-icon="inline-start" />
                Add path
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
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
