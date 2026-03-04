"use client";

import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function CreateProjectDialog({
  workspaceSlug,
  specSlug,
  specTitle,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceSlug: string;
  specSlug: string;
  specTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (projectSlug: string) => void;
}) {
  const utils = trpc.useUtils();
  const createProject = trpc.spec.createProject.useMutation({
    onSuccess: (data) => {
      utils.spec.get.invalidate();
      utils.spec.list.invalidate();
      utils.project.list.invalidate();
      onOpenChange(false);
      onCreated?.(data.slug);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a project from the spec &ldquo;{specTitle || specSlug}&rdquo;. The spec status
            will change to &ldquo;active&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createProject.mutate({ workspaceSlug, specSlug })}
            disabled={createProject.isPending}
          >
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
