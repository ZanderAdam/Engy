import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetDb } from '../db/client';
import { synthesize, MAX_SPEAK_CHARS } from './tts';

// First run downloads the ~65MB Piper voice; later runs reuse the cached
// directory. Shared TEST_ENGY_DIR with the other voice tests so the download
// only ever happens once across the whole suite.
const MODEL_TEST_TIMEOUT = 120_000;
const TEST_ENGY_DIR = path.join(os.tmpdir(), 'engy-voice-test');

beforeAll(() => {
  process.env.ENGY_DIR = TEST_ENGY_DIR;
  resetDb();
});

afterAll(() => {
  delete process.env.ENGY_DIR;
  resetDb();
});

function readWavHeader(wav: Buffer) {
  return {
    riff: wav.subarray(0, 4).toString(),
    wave: wav.subarray(8, 12).toString(),
    channels: wav.readUInt16LE(22),
    sampleRate: wav.readUInt32LE(24),
    bitsPerSample: wav.readUInt16LE(34),
    dataSize: wav.readUInt32LE(40),
  };
}

describe('voice tts', () => {
  describe('synthesize', () => {
    it(
      '[FR-TG2.23] should render text as a playable mono 16-bit WAV',
      async () => {
        const wav = await synthesize('Focused build.');
        const header = readWavHeader(wav);

        expect(header.riff).toBe('RIFF');
        expect(header.wave).toBe('WAVE');
        expect(header.channels).toBe(1);
        expect(header.bitsPerSample).toBe(16);
        expect(header.sampleRate).toBeGreaterThan(0);
        // The declared data size must match what is actually there, or the
        // browser plays silence or truncates.
        expect(header.dataSize).toBe(wav.length - 44);
        expect(header.dataSize).toBeGreaterThan(0);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      '[FR-TG2.23] should return byte-identical audio for repeated text',
      async () => {
        // Acknowledgements repeat constantly, so they are cached.
        const a = await synthesize('Sent.');
        const b = await synthesize('Sent.');
        expect(b.equals(a)).toBe(true);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      'should render different text as different audio',
      async () => {
        const a = await synthesize('Sent.');
        const b = await synthesize('Not sent.');
        expect(b.equals(a)).toBe(false);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      'should treat text differing only in surrounding whitespace as the same utterance',
      async () => {
        const a = await synthesize('Sent.');
        const b = await synthesize('  Sent.  ');
        expect(b.equals(a)).toBe(true);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      '[FR-TG2.23] should cap an over-long input rather than speaking all of it',
      async () => {
        const long = `${'word '.repeat(400)}`;
        expect(long.length).toBeGreaterThan(MAX_SPEAK_CHARS);
        const wav = await synthesize(long);
        const capped = await synthesize(long.slice(0, MAX_SPEAK_CHARS));
        expect(wav.equals(capped)).toBe(true);
      },
      MODEL_TEST_TIMEOUT,
    );

    it('should reject empty text instead of rendering silence', async () => {
      await expect(synthesize('   ')).rejects.toThrow('Nothing to speak');
    });
  });
});
