'use client';

import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/theme-toggle';
import { QuestionList } from '@/components/questions/question-list';
import { QuestionDialog } from '@/components/questions/question-dialog';
import { GlobalSearch } from '@/components/search/global-search';
import { trpc } from '@/lib/trpc';
import { RiQuestionLine, RiSearchLine } from '@remixicon/react';

export function HeaderActions() {
  const { data: unansweredData } = trpc.question.unansweredCount.useQuery({});
  const unansweredCount = unansweredData?.count ?? 0;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSessionKey, setSearchSessionKey] = useState(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchSessionKey((k) => k + 1);
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex items-center gap-1 px-2">
      <button
        type="button"
        onClick={() => {
          setSearchSessionKey((k) => k + 1);
          setSearchOpen(true);
        }}
        aria-label="Search workspace (Cmd+K)"
        className="flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
      >
        <RiSearchLine className="size-4 text-muted-foreground" />
      </button>
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
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} sessionKey={searchSessionKey} />
    </div>
  );
}
