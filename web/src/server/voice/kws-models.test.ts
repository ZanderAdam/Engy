import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDb } from '../db/client';
import { resolveKwsModelDir } from './kws-models';

const KWS_MODEL_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
const REQUIRED_FILES = [
  'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'tokens.txt',
  'bpe.model',
];

describe('kws model cache', () => {
  let engyDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    engyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-kws-models-test-'));
    process.env.ENGY_DIR = engyDir;
    resetDb();
    // Any call is a failure in these tests — the cache must be enough.
    fetchSpy = vi.fn(() => {
      throw new Error('unexpected network fetch');
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(engyDir, { recursive: true, force: true });
    delete process.env.ENGY_DIR;
    resetDb();
  });

  function seedCachedModel(): void {
    const dir = path.join(engyDir, 'models', KWS_MODEL_NAME);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of REQUIRED_FILES) fs.writeFileSync(path.join(dir, file), 'stub');
  }

  describe('resolveKwsModelDir', () => {
    it('[FR-TG2.11] should reuse an already-downloaded model instead of fetching again', async () => {
      seedCachedModel();

      // Two resolves stand in for two turns of the wake-word spotter loading:
      // the cache is keyed by ENGY_DIR, not by call site, so the second is free.
      const first = await resolveKwsModelDir();
      const second = await resolveKwsModelDir();

      expect(first).toBe(path.join(engyDir, 'models', KWS_MODEL_NAME));
      expect(second).toBe(first);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should treat a partially-extracted model as missing', async () => {
      const dir = path.join(engyDir, 'models', KWS_MODEL_NAME);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'tokens.txt'), 'stub');

      await expect(resolveKwsModelDir()).rejects.toThrow('unexpected network fetch');
    });
  });
});
