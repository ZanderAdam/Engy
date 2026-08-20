"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Milestone = { ref: string; title: string };

const NO_MILESTONE = '__none__';

export function TaskGroupForm({
  milestones,
  open,
  onOpenChange,
  onCreated,
}: {
  milestones: Milestone[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const [name, setName] = useState("");
  const [milestoneRef, setMilestoneRef] = useState<string>(NO_MILESTONE);

  const createGroup = trpc.taskGroup.create.useMutation({
    onSuccess: () => {
      setName("");
      setMilestoneRef(NO_MILESTONE);
      onCreated?.();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createGroup.mutate({
      milestoneRef: milestoneRef === NO_MILESTONE ? undefined : milestoneRef,
      name: name.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Task Group</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tg-name">Name</Label>
              <Input
                id="tg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Milestone</Label>
              <Select value={milestoneRef} onValueChange={setMilestoneRef}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Select milestone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MILESTONE}>No milestone</SelectItem>
                  {milestones.map((ms) => (
                    <SelectItem key={ms.ref} value={ms.ref}>
                      {ms.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={!name.trim() || createGroup.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
