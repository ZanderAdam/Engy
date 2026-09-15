import { describe, it, expect } from 'vitest';
import { DEFAULT_VOICE_ID, TTS_VOICES, findVoice } from './voices';

describe('tts voices', () => {
  it('[FR-TG2.34] should find a listed voice by id', () => {
    expect(findVoice('alan').model).toBe('en_GB-alan-medium');
    expect(findVoice('obadiah').speakerId).toBe(2);
  });

  it('[FR-TG2.34] should fall back to the default voice for an unknown id', () => {
    expect(findVoice('../../models/other').id).toBe(DEFAULT_VOICE_ID);
    expect(findVoice(null).id).toBe(DEFAULT_VOICE_ID);
  });

  it('should list the default voice first', () => {
    expect(TTS_VOICES[0].id).toBe(DEFAULT_VOICE_ID);
  });

  it('should give every voice a unique id', () => {
    const ids = TTS_VOICES.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Model names become file and URL paths on the server.
  it('should only name models that are safe to put in a path', () => {
    for (const voice of TTS_VOICES) expect(voice.model).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
