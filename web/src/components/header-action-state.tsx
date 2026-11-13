'use client';

import { useState } from 'react';
import { QuestionDialog } from '@/components/questions/question-dialog';
import { GlobalSearch } from '@/components/search/global-search';
import { ShortcutHelp } from '@/components/shortcut-help';
import { trpc } from '@/lib/trpc';
import { useShortcut } from '@/lib/shortcuts';

export function useHeaderActionState() {
  const { data: unansweredData } = trpc.question.unansweredCount.useQuery({});
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

  return {
    unansweredCount: unansweredData?.count ?? 0,
    selectedTaskId,
    setSelectedTaskId,
    searchOpen,
    setSearchOpen,
    searchSessionKey,
    openSearch,
    helpOpen,
    setHelpOpen,
  };
}

type HeaderActionState = ReturnType<typeof useHeaderActionState>;

export function HeaderActionDialogs({ state }: { state: HeaderActionState }) {
  return (
    <>
      {state.selectedTaskId !== null && (
        <QuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) state.setSelectedTaskId(null);
          }}
          taskId={state.selectedTaskId}
        />
      )}
      <ShortcutHelp open={state.helpOpen} onOpenChange={state.setHelpOpen} />
      <GlobalSearch
        open={state.searchOpen}
        onOpenChange={state.setSearchOpen}
        sessionKey={state.searchSessionKey}
      />
    </>
  );
}
