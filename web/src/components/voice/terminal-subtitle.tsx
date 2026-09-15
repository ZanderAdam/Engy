'use client';

import { useState } from 'react';
import { RiCloseLine, RiVolumeUpLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useOptionalVoice } from './voice-context';
import { dismissSpoken, useLastSpoken } from './spoken-subtitles';

/**
 * One fixed row, present whenever spoken replies are on: Claude Code redraws
 * garbled when its terminal gets shorter, so the row must never change height
 * as replies come and go. A new reply opens in full by growing upward over
 * the terminal, and folds back to one line on click.
 */
export function TerminalSubtitle({ sessionId }: { sessionId: string }) {
  const voice = useOptionalVoice();
  const text = useLastSpoken(sessionId);
  const [foldedText, setFoldedText] = useState<string | null>(null);
  if (!voice?.ttsEnabled) return null;

  const expanded = text !== null && foldedText !== text;

  return (
    <div className="relative h-7 shrink-0 border-t border-border text-xs">
      <span className="sr-only" aria-live="polite">
        {text}
      </span>
      {/* pr-14 keeps text and controls clear of the fixed bottom-terminal toggle. */}
      <div
        className={cn(
          'flex gap-2 bg-background pl-3 pr-14',
          expanded
            ? 'absolute inset-x-0 bottom-0 z-10 max-h-40 items-start overflow-y-auto border-t border-border py-1.5'
            : 'h-full items-center',
        )}
      >
        <RiVolumeUpLine
          className={cn('size-3.5 shrink-0 text-muted-foreground', expanded && 'mt-px')}
          aria-hidden
        />
        <button
          type="button"
          onClick={() => setFoldedText(expanded ? text : null)}
          disabled={!text}
          aria-expanded={expanded}
          className={cn(
            'min-w-0 flex-1 text-left text-foreground disabled:cursor-default',
            !expanded && 'truncate',
          )}
        >
          {text ?? <span className="text-muted-foreground">No spoken reply yet</span>}
        </button>
        {text && (
          <button
            type="button"
            aria-label="Dismiss spoken reply"
            onClick={() => dismissSpoken(sessionId)}
            className={cn('shrink-0 text-muted-foreground hover:text-foreground', expanded && 'mt-px')}
          >
            <RiCloseLine className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
