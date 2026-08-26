import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDb } from '../db/client';
import { resolveModelDir, resolveVadModelPath } from './models';

const MODEL_NAME = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';
const REQUIRED_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'];

describe('voice model cache', () => {
  let engyDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    engyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-models-test-'));
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

  function seedCachedModels(): void {
    const dir = path.join(engyDir, 'models', MODEL_NAME);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of REQUIRED_FILES) fs.writeFileSync(path.join(dir, file), 'stub');
    fs.writeFileSync(path.join(engyDir, 'models', 'silero_vad.onnx'), 'stub');
  }

  describe('resolveModelDir', () => {
    it('[FR-TG1.3] should reuse an already-downloaded model instead of fetching again', async () => {
      seedCachedModels();

      // Two resolves stand in for two workspaces enabling voice in turn: the
      // cache is keyed by ENGY_DIR, not by workspace, so the second is free.
      const first = await resolveModelDir();
      const second = await resolveModelDir();

      expect(first).toBe(path.join(engyDir, 'models', MODEL_NAME));
      expect(second).toBe(first);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should treat a partially-extracted model as missing', async () => {
      const dir = path.join(engyDir, 'models', MODEL_NAME);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'tokens.txt'), 'stub');

      await expect(resolveModelDir()).rejects.toThrow('unexpected network fetch');
    });
  });

  describe('resolveVadModelPath', () => {
    it('[FR-TG1.3] should reuse an already-downloaded VAD model instead of fetching again', async () => {
      seedCachedModels();

      const first = await resolveVadModelPath();
      const second = await resolveVadModelPath();

      expect(first).toBe(path.join(engyDir, 'models', 'silero_vad.onnx'));
      expect(second).toBe(first);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
