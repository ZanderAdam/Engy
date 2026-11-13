'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/theme-toggle';
import { QuestionList } from '@/components/questions/question-list';
import { InboxButton } from '@/components/inbox/inbox-button';
import { HeaderActionDialogs, useHeaderActionState } from '@/components/header-action-state';
import { shortcutText } from '@/lib/shortcuts';
import { RiKeyboardLine, RiQuestionLine, RiSearchLine } from '@remixicon/react';

export function HeaderActions() {
  const state = useHeaderActionState();
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className="flex items-center gap-1 px-2">
      <button
        type="button"
        onClick={state.openSearch}
        aria-label={`Search workspace (${shortcutText('search')})`}
        className="flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
      >
        <RiSearchLine className="size-4 text-muted-foreground" />
      </button>
      <InboxButton />
      <button
        type="button"
        onClick={() => state.setHelpOpen(true)}
        aria-label={`Keyboard shortcuts (${shortcutText('help')})`}
        className="flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
      >
        <RiKeyboardLine className="size-4 text-muted-foreground" />
      </button>
      {state.unansweredCount > 0 && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
            >
              <RiQuestionLine className="size-4 text-muted-foreground" />
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white">
                {state.unansweredCount}
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
                state.setSelectedTaskId(taskId);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <ThemeToggle />
      <HeaderActionDialogs state={state} />
    </div>
  );
}
