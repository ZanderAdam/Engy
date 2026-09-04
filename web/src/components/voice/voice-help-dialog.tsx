'use client';

import { useEffect, useMemo } from 'react';
import { RiMicLine } from '@remixicon/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isTypingTarget } from '@/lib/keyboard';
import { useOpenTerminals } from '@/components/terminal/terminal-session-store';
import { useOptionalVoice, type VoiceControl } from './voice-context';
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
const WAKE_WORD = 'ANGIE';

function buildValueLookup(terminalLabels: string[]): VoiceHelpValueLookup {
  return (action) => {
    switch (action.id) {
      case 'voice.terminal.focus':
      case 'voice.terminal.status.one':
        return terminalLabels;
      default:
        return [];
    }
  };
}

function ActiveVoiceHelpDialog({ voice }: { voice: VoiceControl }) {
  const { actions, helpOpen: open, setHelpOpen: setOpen } = voice;

  const terminals = useOpenTerminals();

  const lookupValues = useMemo(
    () =>
      // Numbers first, then labels: both are sayable on their own, and a
      // combined "1 (build)" example reads as a phrase nobody can speak.
      buildValueLookup([
        ...terminals.map((_, i) => String(i + 1)),
        ...terminals.map((t) => t.scope.scopeLabel),
      ]),
    [terminals],
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
      setOpen(!open);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <RiMicLine className="size-3.5" />
            Voice commands
          </DialogTitle>
          <DialogDescription>
            Say &ldquo;{WAKE_WORD}&rdquo; before any phrase below to address the app. Terminals are
            numbered on the rail while voice is on — say the number. In a conversation, what you
            dictate sends itself once you stop talking.
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
                        <span className="text-muted-foreground">
                          &ldquo;{phrase.template}&rdquo;
                        </span>
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
  return <ActiveVoiceHelpDialog voice={voice} />;
}
