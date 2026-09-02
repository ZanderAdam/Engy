'use client';

import { useOptionalVoice } from './voice-context';

const BOX_CLASS =
  'fixed bottom-4 left-4 z-[60] flex max-w-sm items-start gap-2 rounded border border-border bg-background px-3 py-2 text-xs shadow-md';

/**
 * Minimal dictation status: a listening chip while the mic captures, a
 * transcribing dot while the tail segment is decoded, or a visible error.
 * Once a turn completes, shows what was recognised and, for a segment that
 * carried the wake word, what it resolved to and at what confidence (or
 * that nothing matched) — feedback that stays until the next turn starts.
 * The resolution itself happens once, in `useVoiceCapture`, not here — this
 * only renders the outcome it already computed.
 *
 * While listening the chip is itself the stop control, so ending a turn does
 * not mean reopening the terminal key menu the turn was started from. The
 * mobile start trigger stays in that key bar, where the thumb already is; a
 * permanent floating button cost too much of a phone screen.
 *
 * z-[60] because the mobile terminal sheet is `fixed z-50` portaled to body,
 * so at an equal z-index it paints later and would cover this. Both are
 * root-level siblings, so the number decides; that is not true for anything
 * nested inside the sheet's own stacking context.
 */
export function VoiceIndicator() {
  const voice = useOptionalVoice();
  if (!voice) return null;
  const { phase, error, toggle, transcript, command, answer } = voice;

  if (phase === 'idle' && !error && !transcript && !command && !answer) return null;

  if (phase === 'listening') {
    return (
      <button type="button" onClick={toggle} aria-label="Stop dictation" className={BOX_CLASS}>
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden />
        <span className="text-muted-foreground">Listening… (tap to stop)</span>
      </button>
    );
  }

  return (
    <div className={BOX_CLASS}>
      {phase === 'transcribing' && (
        <>
          <span
            className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500"
            aria-hidden
          />
          <span className="text-muted-foreground">Transcribing…</span>
        </>
      )}
      {error && <span className="text-destructive">{error}</span>}
      {!error && phase === 'idle' && (transcript || command || answer) && (
        <div className="flex flex-col gap-0.5">
          {transcript && <span className="text-muted-foreground">&ldquo;{transcript}&rdquo;</span>}
          {command &&
            (command.matched ? (
              <span className="text-foreground">
                {command.result.action.title} · {Math.round(command.result.confidence * 100)}% match
              </span>
            ) : (
              <span className="text-muted-foreground">No matching action</span>
            ))}
          {answer && <span className="whitespace-pre-line text-foreground">{answer}</span>}
        </div>
      )}
    </div>
  );
}
