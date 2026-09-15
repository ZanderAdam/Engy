import { describe, it, expect, vi } from 'vitest';
import { SpeechQueue, speakUrl } from './speech-queue';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SpeechQueue', () => {
  // The whole reason this class exists: an action acknowledgement and an
  // agent's speak call can land in the same instant, and two voices at once
  // are unintelligible.
  it('[FR-TG2.22] should play one utterance at a time, in order', async () => {
    const playing: string[] = [];
    const gates = [deferred(), deferred()];
    let index = 0;

    const queue = new SpeechQueue({
      play: (url) => {
        playing.push(url);
        return gates[index++].promise;
      },
    });

    queue.enqueue('first');
    queue.enqueue('second');
    await Promise.resolve();

    expect(playing).toEqual(['first']);

    gates[0].resolve();
    await vi.waitFor(() => expect(playing).toEqual(['first', 'second']));
  });

  // Without this the items of a status readout run together: the voice's own
  // longest pause is ~0.15s regardless of punctuation.
  it('[FR-TG2.26] should wait between utterances, but not after the last', async () => {
    const events: string[] = [];
    const queue = new SpeechQueue({
      gapMs: 200,
      play: async (url) => {
        events.push(`play:${url}`);
      },
      wait: async (ms) => {
        events.push(`wait:${ms}`);
      },
    });

    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');

    await vi.waitFor(() => expect(events).toHaveLength(5));
    expect(events).toEqual(['play:a', 'wait:200', 'play:b', 'wait:200', 'play:c']);
  });

  it('should not wait at all for a single utterance', async () => {
    const wait = vi.fn(async () => {});
    const queue = new SpeechQueue({ gapMs: 200, play: async () => {}, wait });
    queue.enqueue('only');
    await vi.waitFor(() => expect(queue.size).toBe(0));
    expect(wait).not.toHaveBeenCalled();
  });

  it('should still gap after an utterance that failed', async () => {
    const wait = vi.fn(async () => {});
    const queue = new SpeechQueue({
      gapMs: 200,
      play: async (url) => {
        if (url === 'bad') throw new Error('boom');
      },
      wait,
      onError: () => {},
    });

    queue.enqueue('bad');
    queue.enqueue('good');

    await vi.waitFor(() => expect(queue.size).toBe(0));
    expect(wait).toHaveBeenCalledWith(200);
  });

  it('[FR-TG2.22] should ignore an empty url', () => {
    const play = vi.fn(async () => {});
    const queue = new SpeechQueue({ play });
    queue.enqueue('');
    expect(play).not.toHaveBeenCalled();
  });

  // One failure must not strand everything queued behind it.
  it('[FR-TG2.22] should keep draining after an utterance fails', async () => {
    const played: string[] = [];
    const errors: string[] = [];
    const queue = new SpeechQueue({
      play: async (url) => {
        if (url === 'bad') throw new Error('boom');
        played.push(url);
      },
      onError: (m) => errors.push(m),
    });

    queue.enqueue('bad');
    queue.enqueue('good');

    await vi.waitFor(() => expect(played).toEqual(['good']));
    expect(errors).toEqual(['boom']);
  });

  it('should drop queued utterances on clear', async () => {
    const played: string[] = [];
    const gate = deferred();
    let first = true;
    const queue = new SpeechQueue({
      play: async (url) => {
        played.push(url);
        if (first) {
          first = false;
          await gate.promise;
        }
      },
    });

    queue.enqueue('one');
    queue.enqueue('two');
    await Promise.resolve();
    queue.clear();
    gate.resolve();

    await vi.waitFor(() => expect(queue.size).toBe(0));
    expect(played).toEqual(['one']);
  });
});

describe('speakUrl', () => {
  it('should encode text and workspace as query parameters', () => {
    const url = speakUrl('my ws', 'Focused build & test?');
    expect(url.startsWith('/api/voice/speak?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('workspace')).toBe('my ws');
    expect(params.get('text')).toBe('Focused build & test?');
  });

  it('[FR-TG2.34] should carry the chosen voice', () => {
    const url = speakUrl('ws', 'Hello.', 'alan');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('voice')).toBe('alan');
  });
});
