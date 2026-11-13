'use client';

import { useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  RiInbox2Line,
  RiMore2Line,
  RiPaletteLine,
  RiQuestionLine,
  RiSearchLine,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { QuestionList } from '@/components/questions/question-list';
import { HeaderActionDialogs, useHeaderActionState } from '@/components/header-action-state';
import { formatInboxBadge } from '@/components/inbox/inbox-button';
import { useOpenInbox } from '@/components/tabs/use-go-to-chords';
import { useThemeFlavor, type ThemeFlavor } from '@/components/theme-provider';
import { trpc } from '@/lib/trpc';
import { hasHeaderAttention } from './header-attention';

export function MobileHeaderMenu() {
  const state = useHeaderActionState();
  const openInbox = useOpenInbox();
  const { data: inboxCounts } = trpc.inbox.counts.useQuery();
  const { resolvedTheme, setTheme } = useTheme();
  const { flavor, setFlavor } = useThemeFlavor();
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const keepFocusOnClose = useRef(false);

  const inboxUnreadPriority = inboxCounts?.unreadPriority ?? 0;
  const inboxBadge = formatInboxBadge(inboxUnreadPriority);
  const attention = hasHeaderAttention({
    inboxUnreadPriority,
    unansweredCount: state.unansweredCount,
  });
  const isCyberpunk = flavor === 'cyberpunk';

  const openFromMenu = (open: () => void) => {
    keepFocusOnClose.current = true;
    open();
  };

  return (
    <Popover open={questionsOpen} onOpenChange={setQuestionsOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative"
              aria-label={attention ? 'More actions, items need attention' : 'More actions'}
            >
              <RiMore2Line className="size-4" />
              {attention && (
                <span
                  aria-hidden
                  className="absolute right-1 top-1 size-2 rounded-full bg-red-500"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(event) => {
            if (!keepFocusOnClose.current) return;
            keepFocusOnClose.current = false;
            event.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => openFromMenu(state.openSearch)}>
            <RiSearchLine />
            Search
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openFromMenu(openInbox)}>
            <RiInbox2Line />
            Inbox
            {inboxBadge && <MenuCount>{inboxBadge}</MenuCount>}
          </DropdownMenuItem>
          {state.unansweredCount > 0 && (
            <DropdownMenuItem onSelect={() => openFromMenu(() => setQuestionsOpen(true))}>
              <RiQuestionLine />
              Questions
              <MenuCount>{state.unansweredCount}</MenuCount>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={resolvedTheme === 'dark'}
            disabled={isCyberpunk}
            onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          >
            Dark mode
          </DropdownMenuCheckboxItem>
          <DropdownMenuLabel className="flex items-center gap-1.5">
            <RiPaletteLine className="size-3.5" />
            Theme
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={flavor}
            onValueChange={(v) => setFlavor(v as ThemeFlavor)}
          >
            <DropdownMenuRadioItem value="default">Default</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="cyberpunk">Cyberpunk</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-medium">Unanswered Questions</p>
        </div>
        <QuestionList
          onSelectTask={(taskId) => {
            setQuestionsOpen(false);
            state.setSelectedTaskId(taskId);
          }}
        />
      </PopoverContent>
      <HeaderActionDialogs state={state} />
    </Popover>
  );
}

function MenuCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-4 text-white">
      {children}
    </span>
  );
}
