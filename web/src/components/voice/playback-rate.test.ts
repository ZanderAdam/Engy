// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readPlaybackRate, writePlaybackRate } from './playback-rate';
import { playViaAudio } from './speech-queue';

describe('playback rate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('[FR-TG2.33] should default to normal speed', () => {
    expect(readPlaybackRate()).toBe(1);
  });

  it('[FR-TG2.33] should remember a chosen speed', () => {
    writePlaybackRate(1.5);

    expect(readPlaybackRate()).toBe(1.5);
  });

  it('should ignore a stored value that is not an offered speed', () => {
    localStorage.setItem('engy.voice.playbackRate', '9');

    expect(readPlaybackRate()).toBe(1);
  });

  it('should use normal speed when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(readPlaybackRate()).toBe(1);
    } finally {
      getItem.mockRestore();
    }
  });

  it('[FR-TG2.33] should play replies at the chosen speed', () => {
    const created: { playbackRate: number }[] = [];
    class FakeAudio {
      playbackRate = 1;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        created.push(this);
      }
      play() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    try {
      writePlaybackRate(1.5);

      void playViaAudio('/api/voice/speak?text=hi');

      expect(created[0].playbackRate).toBe(1.5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
