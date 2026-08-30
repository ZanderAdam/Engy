'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RiMicLine } from '@remixicon/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc';
import { useTabsList, useVirtualParams } from '@/components/tabs/tab-context';
import type { VirtualParams } from '@/components/tabs/tab-state';
import { isTypingTarget } from '@/lib/keyboard';
import { createHelpActions } from '@/lib/voice/actions/help';
import { useOptionalVoice } from './voice-context';
import { fetchAllTerminalSessions, useVoiceVocabulary } from './use-voice-vocabulary';
import {
  buildVoiceHelpEntries,
  groupVoiceHelpEntries,
  type VoiceHelpValueLookup,
} from './voice-help-entries';

// Mirrors `DEFAULT_WAKE_WORD` in `web/src/server/voice/keywords.ts`. That
// module reads `node:fs`, which breaks the client bundle if imported here —
// `voice-help-entries.test.ts` imports the real constant and asserts it
// still equals this one, so a change there fails a test instead of drifting
// silently.
const WAKE_WORD = 'ENGY';

function buildValueLookup(
  projectNames: string[],
  tabTitles: string[],
  terminalLabels: string[],
): VoiceHelpValueLookup {
  return (action) => {
    switch (action.id) {
      case 'voice.navigation.select-project':
        return projectNames;
      case 'voice.navigation.open-tab':
        return tabTitles;
      case 'voice.terminal.focus':
        return terminalLabels;
      default:
        return [];
    }
  };
}

function ActiveVoiceHelpDialog() {
  const [open, setOpen] = useState(false);

  const vocabularyActions = useVoiceVocabulary();
  const helpActions = useMemo(() => createHelpActions({ openHelp: () => setOpen(true) }), []);
  const actions = useMemo(
    () => [...vocabularyActions, ...helpActions],
    [vocabularyActions, helpActions],
  );

  const params = useVirtualParams<VirtualParams>();
  const workspaceSlug = params.workspace ?? '';
  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );
  const { data: projects } = trpc.project.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );
  const { data: terminals } = useQuery({
    queryKey: ['voice-vocabulary-terminal-sessions'],
    queryFn: fetchAllTerminalSessions,
    refetchInterval: 5_000,
  });
  const tabsList = useTabsList();

  const lookupValues = useMemo(
    () =>
      buildValueLookup(
        (projects ?? []).map((p) => p.name),
        (tabsList?.tabs ?? []).map((t) => t.title),
        (terminals ?? []).map((t) => t.label),
      ),
    [projects, tabsList, terminals],
  );

  const entries = useMemo(
    () => buildVoiceHelpEntries(actions, WAKE_WORD, lookupValues),
    [actions, lookupValues],
  );
  const grouped = useMemo(() => groupVoiceHelpEntries(entries), [entries]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== '?') return;
      if (isTypingTarget()) return;
      e.preventDefault();
      setOpen((o) => !o);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <RiMicLine className="size-3.5" />
            Voice commands
          </DialogTitle>
          <DialogDescription>
            Say &ldquo;{WAKE_WORD}&rdquo; before any phrase below to address the app.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([category, categoryEntries]) => (
            <div key={category} className="flex flex-col gap-2">
              <h3 className="text-[11px] font-medium uppercase text-muted-foreground">
                {category}
              </h3>
              {categoryEntries.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-1">
                  <span className="text-foreground">{entry.title}</span>
                  {entry.phrases.map((phrase, phraseIdx) => (
                    <div key={phraseIdx} className="flex flex-col gap-0.5 pl-2">
                      {phrase.examples.length > 0 ? (
                        <>
                          {phrase.examples.map((example, exampleIdx) => (
                            <span key={exampleIdx} className="text-muted-foreground">
                              &ldquo;{example}&rdquo;
                            </span>
                          ))}
                          {phrase.moreCount > 0 && (
                            <span className="text-[11px] text-muted-foreground/70">
                              +{phrase.moreCount} more
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">&ldquo;{phrase.template}&rdquo;</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Null when the workspace has voice off (`useOptionalVoice()`), so no
 * dictation vocabulary is fetched and no keyboard listener is attached. */
export function VoiceHelpDialog() {
  const voice = useOptionalVoice();
  if (!voice) return null;
  return <ActiveVoiceHelpDialog />;
}
