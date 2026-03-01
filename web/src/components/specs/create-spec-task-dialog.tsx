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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiAddLine } from "@remixicon/react";

interface CreateSpecTaskDialogProps {
  specSlug: string;
}

export function CreateSpecTaskDialog({
  specSlug,
}: CreateSpecTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"human" | "ai">("human");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const specId = specSlug;

  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => {
      utils.task.listBySpecId.invalidate({ specId });
      setOpen(false);
      setTitle("");
      setType("human");
      setDescription("");
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createMutation.mutate({
      title: title.trim(),
      specId,
      type,
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RiAddLine data-icon="inline-start" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Research auth providers"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "human" | "ai")}>
                <SelectTrigger id="task-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="human">Human</SelectItem>
                  <SelectItem value="ai">AI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-desc">Description (optional)</Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the task..."
                className="min-h-[80px]"
              />
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
