"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiAddLine } from "@remixicon/react";

interface CreateSpecDialogProps {
  workspaceSlug: string;
  onCreated?: (specSlug: string) => void;
}

export function CreateSpecDialog({
  workspaceSlug,
  onCreated,
}: CreateSpecDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"buildable" | "vision">("buildable");
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const createMutation = trpc.spec.create.useMutation({
    onSuccess: (data) => {
      utils.spec.list.invalidate();
      setOpen(false);
      setTitle("");
      setType("buildable");
      setError(null);
      onCreated?.(data.name);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) return;
    createMutation.mutate({ workspaceSlug, title: title.trim(), type });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RiAddLine data-icon="inline-start" />
          New Spec
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Spec</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="spec-title">Title</Label>
              <Input
                id="spec-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. User Authentication"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="spec-type">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as "buildable" | "vision")}
              >
                <SelectTrigger id="spec-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buildable">Buildable</SelectItem>
                  <SelectItem value="vision">Vision</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {type === "buildable"
                  ? "Buildable specs follow a lifecycle: draft, ready, approved, active, completed."
                  : "Vision specs are lighter: draft to completed."}
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !title.trim()}
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
