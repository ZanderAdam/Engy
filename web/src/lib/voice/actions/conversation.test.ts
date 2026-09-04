import { describe, it, expect, vi } from 'vitest';
import { resolveAction } from '../resolve';
import { createConversationActions } from './conversation';

function run(active: boolean, phrase: string) {
  const setActive = vi.fn();
  const resolved = resolveAction(phrase, createConversationActions({ active, setActive }));
  expect(resolved.matched, `"${phrase}" did not resolve`).toBe(true);
  if (!resolved.matched) return { setActive, answer: null, id: null };
  return {
    setActive,
    id: resolved.result.action.id,
    answer: (resolved.result.action.run({ params: {} }) as string) ?? null,
  };
}

describe('conversation actions', () => {
  it.each(['start conversation', 'start talking', 'conversation mode'])(
    '[FR-TG2.27] should turn the mode on via "%s"',
    (phrase) => {
      const { setActive, id } = run(false, phrase);
      expect(id).toBe('voice.conversation.start');
      expect(setActive).toHaveBeenCalledWith(true);
    },
  );

  it.each(['stop conversation', 'stop talking', 'end conversation'])(
    '[FR-TG2.27] should turn the mode off via "%s"',
    (phrase) => {
      const { setActive, id } = run(true, phrase);
      expect(id).toBe('voice.conversation.stop');
      expect(setActive).toHaveBeenCalledWith(false);
    },
  );

  // Entering the mode has no visible effect, so the spoken answer is the only
  // signal that it took.
  it('[FR-TG2.27] should say what the mode does when it starts', () => {
    expect(run(false, 'start conversation').answer).toContain('send');
  });

  it('should not re-enter a mode that is already on', () => {
    const { setActive, answer } = run(true, 'start conversation');
    expect(setActive).not.toHaveBeenCalled();
    expect(answer).toBe('Already in a conversation.');
  });

  it('should not leave a mode that is already off', () => {
    const { setActive, answer } = run(false, 'stop conversation');
    expect(setActive).not.toHaveBeenCalled();
    expect(answer).toBe('Not in a conversation.');
  });

  // "start talking" and "stop talking" differ by one word, and a fixed-word
  // match is scored by its worst word — so they must not cross over.
  it('[FR-TG2.27] should keep start and stop apart', () => {
    expect(run(false, 'start talking').id).toBe('voice.conversation.start');
    expect(run(true, 'stop talking').id).toBe('voice.conversation.stop');
  });
});
