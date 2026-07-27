'use client';

import { useEffect, useRef, useState } from 'react';
import { RiSendPlane2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';

interface MobileComposerProps {
  onCancel: () => void;
  onSubmit: (text: string) => void;
}

/**
 * Full-pane compose overlay for mobile. Typing happens in a real textarea with
 * every keyboard nicety left on — autocorrect, suggestions, a working Enter key
 * — and the finished text goes to the PTY as a single paste. That sidesteps
 * predictive-keyboard composition against xterm's hidden input, which duplicates
 * and jumbles characters on Android (xterm.js#3600).
 *
 * The action row sits at the top so the virtual keyboard, which covers the lower
 * half of the screen, can never hide Send.
 */
export function MobileComposer({ onCancel, onSubmit }: MobileComposerProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0;

  // Mounted only while composing, so raising the keyboard on mount is the point.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compose terminal message"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      className="absolute inset-0 z-20 flex flex-col bg-zinc-900"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">Compose</span>
        <Button size="sm" disabled={!canSend} onClick={() => onSubmit(text)}>
          <RiSendPlane2Line className="size-4" aria-hidden />
          Send
        </Button>
      </div>
      <textarea
        ref={inputRef}
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message. Enter adds a new line; Send delivers it as one paste."
        enterKeyHint="enter"
        className="flex-1 resize-none bg-transparent p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
      />
    </div>
  );
}
