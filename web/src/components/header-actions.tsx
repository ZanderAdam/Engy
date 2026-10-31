'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/theme-toggle';
import { QuestionList } from '@/components/questions/question-list';
import { QuestionDialog } from '@/components/questions/question-dialog';
import { GlobalSearch } from '@/components/search/global-search';
import { InboxButton } from '@/components/inbox/inbox-button';
import { trpc } from '@/lib/trpc';
import { shortcutText, useShortcut } from '@/lib/shortcuts';
import { ShortcutHelp } from '@/components/shortcut-help';
import { RiKeyboardLine, RiQuestionLine, RiSearchLine } from '@remixicon/react';

export function HeaderActions() {
  const { data: unansweredData } = trpc.question.unansweredCount.useQuery({});
  const unansweredCount = unansweredData?.count ?? 0;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSessionKey, setSearchSessionKey] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const openSearch = () => {
    setSearchSessionKey((k) => k + 1);
    setSearchOpen(true);
  };

  useShortcut('search', openSearch);
  useShortcut('help', () => setHelpOpen((open) => !open));

  return (
    <div className="flex items-center gap-1 px-2">
      <button
        type="button"
        onClick={openSearch}
        aria-label={`Search workspace (${shortcutText('search')})`}
        className="flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
      >
        <RiSearchLine className="size-4 text-muted-foreground" />
      </button>
      <InboxButton />
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-label={`Keyboard shortcuts (${shortcutText('help')})`}
        className="flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
      >
        <RiKeyboardLine className="size-4 text-muted-foreground" />
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
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} sessionKey={searchSessionKey} />
    </div>
  );
}
