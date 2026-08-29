import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetDb } from '../db/client';
import { createWakeStream, preloadSpotter } from './spotter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 20ms at 16kHz s16le mono — matches the browser audio-worklet's chunk framing.
const CHUNK_BYTES = 640;
// First run downloads the (small, ~19MB) KWS model; later runs reuse the
// cached directory. Shared TEST_ENGY_DIR with recognizer.test.ts/keywords.test.ts
// so the download only ever happens once across the whole suite.
const MODEL_TEST_TIMEOUT = 60_000;
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

async function feedAll(chunks: Buffer[]): Promise<boolean> {
  const stream = await createWakeStream();
  let fired = false;
  for (const chunk of chunks) {
    if (stream.writeChunk(chunk)) fired = true;
  }
  return fired;
}

function chunkPcm(pcm: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
    chunks.push(pcm.subarray(offset, offset + CHUNK_BYTES));
  }
  return chunks;
}

describe('wake-word spotter', () => {
  describe('createWakeStream', () => {
    it('should not throw when creating multiple independent streams', async () => {
      const a = await createWakeStream();
      const b = await createWakeStream();
      expect(a).not.toBe(b);
    });

    // The single most important safety property this module has: an
    // always-on session must not put words in the user's mouth. Every
    // recording here is a real capture from earlier manual testing (see
    // web/.dev-engy/voice-dumps and fixture.wav) — none contains the wake
    // word, so any detection here is a false accept. Measured across the
    // full threshold/boost sweep in the task report: 0/135 false accepts at
    // every candidate operating point tried, including the shipped one.
    it(
      '[FR-TG2.11] should not fire on real recordings that never say the wake word',
      async () => {
        const fixturePath = path.join(__dirname, 'fixture.wav');
        // .dev-engy/ is gitignored (dev-local capture dumps), so it may not
        // exist in a fresh checkout — fixture.wav alone still guards the
        // property; the dumps just widen coverage when present locally.
        const dumpDir = path.join(__dirname, '../../../.dev-engy/voice-dumps');
        const negativePaths = [fixturePath];
        if (fs.existsSync(dumpDir)) {
          for (const f of fs.readdirSync(dumpDir).slice(0, 10)) {
            if (f.endsWith('.wav')) negativePaths.push(path.join(dumpDir, f));
          }
        }
        expect(negativePaths.length).toBeGreaterThanOrEqual(1);

        for (const p of negativePaths) {
          const fired = await feedAll(chunkPcm(readWavPcm16(p)));
          expect(fired, `false accept on ${path.basename(p)}`).toBe(false);
        }
      },
      MODEL_TEST_TIMEOUT * 2,
    );
  });

  describe('preloadSpotter', () => {
    it('should not throw synchronously and should not block on the model load', () => {
      expect(() => preloadSpotter()).not.toThrow();
    });
  });
});
