'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/theme-toggle';
import { QuestionList } from '@/components/questions/question-list';
import { QuestionDialog } from '@/components/questions/question-dialog';
import { trpc } from '@/lib/trpc';
import { RiQuestionLine } from '@remixicon/react';

export function HeaderActions() {
  const { data: unansweredData } = trpc.question.unansweredCount.useQuery({});
  const unansweredCount = unansweredData?.count ?? 0;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  return (
    <div className="flex items-center gap-1 px-2">
      {unansweredCount > 0 && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
            >
              <RiQuestionLine className="size-4 text-muted-foreground" />
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white">
                {unansweredCount}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            <div className="border-b border-border px-3 py-2">
              <p className="text-xs font-medium">Unanswered Questions</p>
            </div>
            <QuestionList
              onSelectTask={(taskId) => {
                setPopoverOpen(false);
                setSelectedTaskId(taskId);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <ThemeToggle />
      {selectedTaskId !== null && (
        <QuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
          taskId={selectedTaskId}
        />
      )}
    </div>
  );
}
