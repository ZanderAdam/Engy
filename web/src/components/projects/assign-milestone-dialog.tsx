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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Milestone = { ref: string; title: string };

export function AssignMilestoneDialog({
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
  const [milestoneRef, setMilestoneRef] = useState<string>('');

  const utils = trpc.useUtils();
  const bulkUpdate = trpc.task.bulkUpdate.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      utils.task.get.invalidate();
      setMilestoneRef('');
      onComplete?.();
    },
    onError: () => toast.error('Failed to assign milestone'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!milestoneRef || selectedIds.size === 0) return;
    bulkUpdate.mutate({
      ids: Array.from(selectedIds),
      milestoneRef,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Assign {selectedIds.size} Tasks to Milestone</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
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
            <Button type="submit" disabled={!milestoneRef || bulkUpdate.isPending}>
              Assign Milestone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
