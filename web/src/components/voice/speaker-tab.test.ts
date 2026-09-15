import { describe, it, expect } from 'vitest';
import { createSpeakerTab } from './speaker-tab';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const focused = () => true;
const unfocused = () => false;

describe('speaker tab', () => {
  it('[FR-TG2.30] should let only the last focused tab speak', () => {
    const storage = memoryStorage();
    const first = createSpeakerTab('ws', storage, 'first', focused);
    const second = createSpeakerTab('ws', storage, 'second', focused);

    first.claim();
    second.claim();
    expect(first.isSpeaker()).toBe(false);
    expect(second.isSpeaker()).toBe(true);

    first.claim();
    expect(first.isSpeaker()).toBe(true);
    expect(second.isSpeaker()).toBe(false);
  });

  it('[FR-TG2.30] should give each workspace its own speaker', () => {
    const storage = memoryStorage();
    const one = createSpeakerTab('one', storage, 'a', focused);
    const two = createSpeakerTab('two', storage, 'b', focused);

    one.claim();
    two.claim();

    expect(one.isSpeaker()).toBe(true);
    expect(two.isSpeaker()).toBe(true);
  });

  it('should hand speaking to the focused tab once the owner closes', () => {
    const storage = memoryStorage();
    const owner = createSpeakerTab('ws', storage, 'owner', focused);
    const active = createSpeakerTab('ws', storage, 'active', focused);
    const background = createSpeakerTab('ws', storage, 'background', unfocused);

    owner.claim();
    owner.release();

    expect(active.isSpeaker()).toBe(true);
    expect(background.isSpeaker()).toBe(false);
  });

  it('[FR-TG2.30] should let only the focused tab speak when none owns playback', () => {
    const storage = memoryStorage();
    const left = createSpeakerTab('ws', storage, 'left', focused);
    const right = createSpeakerTab('ws', storage, 'right', unfocused);

    expect(left.isSpeaker()).toBe(true);
    expect(right.isSpeaker()).toBe(false);
  });

  it('should not release a claim another tab holds', () => {
    const storage = memoryStorage();
    const closing = createSpeakerTab('ws', storage, 'closing', focused);
    const owner = createSpeakerTab('ws', storage, 'owner', unfocused);

    owner.claim();
    closing.release();

    expect(owner.isSpeaker()).toBe(true);
  });

  it('should fall back to focus when storage is unavailable', () => {
    const failing = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {},
    };
    const tab = createSpeakerTab('ws', failing, 'tab', focused);

    expect(() => tab.claim()).not.toThrow();
    expect(() => tab.release()).not.toThrow();
    expect(tab.isSpeaker()).toBe(true);
  });
});
