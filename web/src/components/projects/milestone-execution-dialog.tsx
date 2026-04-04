'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExecutionTab } from './execution-tab';

interface MilestoneExecutionDialogProps {
  milestoneNum: number;
  milestoneRef: string;
  sessionId: string;
  status: string | null;
  completionSummary?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MilestoneExecutionDialog({
  milestoneNum,
  milestoneRef,
  sessionId,
  status,
  completionSummary,
  open,
  onOpenChange,
}: MilestoneExecutionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[60vw] max-w-4xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>M{milestoneNum} Execution</DialogTitle>
        </DialogHeader>
        <ExecutionTab
          scope="milestone"
          scopeId={milestoneRef}
          sessionId={sessionId}
          status={status}
          completionSummary={completionSummary}
        />
      </DialogContent>
    </Dialog>
  );
}
