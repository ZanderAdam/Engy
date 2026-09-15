import { readPlaybackRate } from './playback-rate';

/**
 * Serialises spoken answers. Two utterances at once are unintelligible, and
 * they arrive from independent sources — a local action acknowledgement and
 * an agent's `speak` call can land in the same instant — so ordering has to
 * be owned in one place rather than by either caller.
 *
 * Kept free of React so it can be tested without a renderer.
 */
interface SpeechQueueOpts {
  /** Injectable for tests; defaults to the DOM Audio element. */
  play?: (url: string) => Promise<void>;
  onError?: (message: string) => void;
  /** Silence inserted between utterances, never after the last one.
   *
   * The voice does not pause on punctuation — measured, the longest gap it
   * produces is ~0.15s whether the text is joined by newlines, periods or
   * semicolons — so a multi-item readout runs together into one mush unless
   * the gap is added here. */
  gapMs?: number;
  /** Injectable for tests, so they need no timers. */
  wait?: (ms: number) => Promise<void>;
  /** Fires true when the queue starts speaking and false when it runs dry.
   * The mic stays open through an answer, so the caller needs this to stop
   * the answer being transcribed back. */
  onSpeakingChange?: (speaking: boolean) => void;
}

const DEFAULT_GAP_MS = 350;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function playViaAudio(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.playbackRate = readPlaybackRate();
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Could not play the spoken reply.'));
    void audio.play().catch(reject);
  });
}

export class SpeechQueue {
  private readonly pending: string[] = [];
  private draining = false;

  constructor(private readonly opts: SpeechQueueOpts) {}

  /** Queues one audio URL. The queue deals in URLs, not text — what to say
   * and which workspace says it are the caller's business, and keeping them
   * out means the queue never has to be rebuilt when either changes. */
  enqueue(url: string): void {
    if (!url) return;
    this.pending.push(url);
    void this.drain();
  }

  /** Drops anything not yet spoken. The utterance already playing finishes —
   * stopping mid-word reads as a bug, not as an interruption. */
  clear(): void {
    this.pending.length = 0;
  }

  get size(): number {
    return this.pending.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.opts.onSpeakingChange?.(true);
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (next === undefined) break;
        try {
          await (this.opts.play ?? playViaAudio)(next);
        } catch (err) {
          // One utterance failing must not strand the rest of the queue.
          this.opts.onError?.(err instanceof Error ? err.message : 'Speech failed.');
        }
        if (this.pending.length > 0) {
          const gap = this.opts.gapMs ?? DEFAULT_GAP_MS;
          if (gap > 0) await (this.opts.wait ?? defaultWait)(gap);
        }
      }
    } finally {
      this.draining = false;
      this.opts.onSpeakingChange?.(false);
    }
  }
}

export function speakUrl(workspaceSlug: string, text: string): string {
  const params = new URLSearchParams({ workspace: workspaceSlug, text });
  return `/api/voice/speak?${params.toString()}`;
}
