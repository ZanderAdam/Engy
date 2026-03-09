"use client";

import { useState } from "react";
import { RiAddLine, RiCloseLine } from "@remixicon/react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditWorkspaceDialogProps {
  workspace: {
    id: number;
    name: string;
    slug: string;
    repos: string[] | null;
    docsDir: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (newSlug: string) => void;
}

function initialRepos(repos: string[] | null): string[] {
  return repos && repos.length > 0 ? repos : [""];
}

export function EditWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
  onSaved,
}: EditWorkspaceDialogProps) {
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [docsDir, setDocsDir] = useState(workspace.docsDir ?? "");
  const [repos, setRepos] = useState<string[]>(initialRepos(workspace.repos));
  const [error, setError] = useState<string | null>(null);

  const updateMutation = trpc.workspace.update.useMutation({
    onSuccess: () => {
      onSaved(slug);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function addRepo() {
    setRepos([...repos, ""]);
  }

  function removeRepo(index: number) {
    setRepos(repos.filter((_, i) => i !== index));
  }

  function updateRepo(index: number, value: string) {
    const updated = [...repos];
    updated[index] = value;
    setRepos(updated);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const filteredRepos = repos.map((r) => r.trim()).filter((r) => r !== "");
    const trimmedDocsDir = docsDir.trim();
    updateMutation.mutate({
      id: workspace.id,
      name,
      slug: slug !== workspace.slug ? slug : undefined,
      repos: filteredRepos,
      docsDir: trimmedDocsDir || null,
    });
  }

  function deriveSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
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
      setDocsDir(workspace.docsDir ?? "");
      setRepos(initialRepos(workspace.repos));
      setError(null);
    }
    onOpenChange(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Workspace</DialogTitle>
            <DialogDescription>Update workspace settings.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-workspace-name">Name</Label>
              <Input
                id="edit-workspace-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
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
              <p className="text-xs text-muted-foreground">
                Used in the URL: /w/{slug || "..."}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-workspace-docs-dir">Docs location</Label>
              <Input
                id="edit-workspace-docs-dir"
                value={docsDir}
                onChange={(e) => setDocsDir(e.target.value)}
                placeholder="/path/to/docs"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the default Engy data directory.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Repository paths</Label>
              {repos.map((repo, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    className="flex-1"
                    value={repo}
                    onChange={(e) => updateRepo(i, e.target.value)}
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={addRepo}
              >
                <RiAddLine data-icon="inline-start" />
                Add path
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
