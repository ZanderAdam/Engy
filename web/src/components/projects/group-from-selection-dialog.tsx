'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Milestone = { ref: string; title: string };

export function GroupFromSelectionDialog({
  milestones,
  selectedIds,
  open,
  onOpenChange,
  onComplete,
}: {
  milestones: Milestone[];
  selectedIds: Set<number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}) {
  const [name, setName] = useState('');
  const [milestoneRef, setMilestoneRef] = useState<string>('');

  const utils = trpc.useUtils();
  const createGroup = trpc.taskGroup.create.useMutation({
    onError: () => toast.error('Failed to create task group'),
  });
  const bulkUpdate = trpc.task.bulkUpdate.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      utils.task.get.invalidate();
      utils.taskGroup.list.invalidate();
      setName('');
      setMilestoneRef('');
      onComplete?.();
    },
    onError: () => toast.error('Failed to assign tasks to group'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !milestoneRef || selectedIds.size === 0) return;
    createGroup.mutate(
      { milestoneRef, name: name.trim() },
      {
        onSuccess: (group) => {
          bulkUpdate.mutate({
            ids: Array.from(selectedIds),
            taskGroupId: group.id,
            milestoneRef,
          });
        },
      },
    );
  }

  const isPending = createGroup.isPending || bulkUpdate.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Group {selectedIds.size} Tasks</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
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
            <Button type="submit" disabled={!name.trim() || !milestoneRef || isPending}>
              Create Group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
