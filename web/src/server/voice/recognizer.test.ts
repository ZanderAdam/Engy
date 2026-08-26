import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTurnRecognizer } from './recognizer';
import { resolveModelDir } from './models';
import { resetDb } from '../db/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixture.wav');
// 20ms at 16kHz s16le mono — matches the browser audio-worklet's chunk framing.
const CHUNK_BYTES = 640;
const SAMPLE_RATE = 16_000;
// First run downloads and extracts a ~631MB model archive; later runs reuse
// the cached directory under ENGY_DIR and are fast.
const MODEL_TEST_TIMEOUT = 120_000;

// A fixed, non-prod ENGY_DIR shared across test runs. Never ~/.engy (the repo
// convention is that tests must not touch prod data) and never a per-test
// mkdtemp (that would force a fresh ~120MB model download every run).
const TEST_ENGY_DIR = path.join(os.tmpdir(), 'engy-voice-test');

beforeAll(() => {
  process.env.ENGY_DIR = TEST_ENGY_DIR;
  resetDb();
});

afterAll(() => {
  delete process.env.ENGY_DIR;
  resetDb();
});

function readWavPcm16(filePath: string): Buffer {
  const buf = fs.readFileSync(filePath);
  const dataIdx = buf.indexOf('data');
  if (dataIdx < 0) throw new Error(`${filePath}: not a RIFF/WAVE file with a data chunk`);
  const dataSize = buf.readUInt32LE(dataIdx + 4);
  return buf.subarray(dataIdx + 8, dataIdx + 8 + dataSize);
}

describe('voice recognizer', () => {
  describe('resolveModelDir', () => {
    it(
      'should download and extract the model, staying idempotent across concurrent callers',
      async () => {
        const [a, b] = await Promise.all([resolveModelDir(), resolveModelDir()]);

        expect(a).toBe(b);
        expect(fs.existsSync(path.join(a, 'tokens.txt'))).toBe(true);
      },
      MODEL_TEST_TIMEOUT,
    );
  });

  describe('createTurnRecognizer', () => {
    it(
      'should emit a non-empty segment for a spoken fixture',
      async () => {
        const pcm = readWavPcm16(FIXTURE_PATH);
        const segments: string[] = [];
        const errors: Error[] = [];

        const turn = await createTurnRecognizer({
          onSegment: (text) => segments.push(text),
          onError: (err) => errors.push(err),
        });

        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
          turn.writeChunk(pcm.subarray(offset, offset + CHUNK_BYTES));
        }
        turn.close();

        expect(errors).toEqual([]);
        expect(segments.length).toBeGreaterThanOrEqual(1);
        expect(segments[0]).toBeTruthy();
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      'should emit multiple segments, in order, for multi-phrase audio',
      async () => {
        // Two copies of the same spoken fixture separated by a real gap of
        // silence — enough for the VAD's minSilenceDuration to close the
        // first segment before the second one starts.
        const phrase = readWavPcm16(FIXTURE_PATH);
        const silenceGap = Buffer.alloc(SAMPLE_RATE * 2); // 1s of s16le silence
        const combined = Buffer.concat([phrase, silenceGap, phrase]);
        const segments: string[] = [];
        const errors: Error[] = [];

        const turn = await createTurnRecognizer({
          onSegment: (text) => segments.push(text),
          onError: (err) => errors.push(err),
        });

        for (let offset = 0; offset < combined.length; offset += CHUNK_BYTES) {
          turn.writeChunk(combined.subarray(offset, offset + CHUNK_BYTES));
        }
        turn.close();

        expect(errors).toEqual([]);
        expect(segments.length).toBeGreaterThanOrEqual(2);
        expect(segments.every((text) => text.length > 0)).toBe(true);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      'should flush and decode a trailing segment that never closed on silence',
      async () => {
        // Cut the fixture off mid-utterance — no trailing silence at all, so
        // minSilenceDuration is never crossed and nothing closes on its own.
        const phrase = readWavPcm16(FIXTURE_PATH);
        const truncated = phrase.subarray(0, Math.floor(phrase.length * 0.6));
        const segments: string[] = [];
        const errors: Error[] = [];

        const turn = await createTurnRecognizer({
          onSegment: (text) => segments.push(text),
          onError: (err) => errors.push(err),
        });

        for (let offset = 0; offset < truncated.length; offset += CHUNK_BYTES) {
          turn.writeChunk(truncated.subarray(offset, offset + CHUNK_BYTES));
        }
        // Nothing should have closed on its own yet — no silence was fed.
        expect(segments).toEqual([]);

        turn.close();

        expect(errors).toEqual([]);
        expect(segments.length).toBeGreaterThanOrEqual(1);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      'should ignore writes after close without throwing',
      async () => {
        const turn = await createTurnRecognizer({
          onSegment: () => {},
          onError: (err) => {
            throw err;
          },
        });

        turn.close();

        expect(() => turn.writeChunk(Buffer.alloc(CHUNK_BYTES))).not.toThrow();
      },
      MODEL_TEST_TIMEOUT,
    );
  });
});
