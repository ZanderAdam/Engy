import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetDb } from '../db/client';
import { resolveKwsModelDir } from './kws-models';
import {
  DEFAULT_WAKE_WORD,
  encodeToPieces,
  encodeWakeWord,
  formatKeywordLine,
  parseBpeModel,
  type BpeModel,
} from './keywords';

// Shared with kws-models.test.ts's sibling in recognizer.test.ts: a fixed,
// non-prod ENGY_DIR so the (small, ~19MB) real KWS model downloads once and
// is reused across runs rather than a fresh mkdtemp forcing a redownload.
const TEST_ENGY_DIR = path.join(os.tmpdir(), 'engy-voice-test');
const MODEL_TEST_TIMEOUT = 60_000;

beforeAll(() => {
  process.env.ENGY_DIR = TEST_ENGY_DIR;
  resetDb();
});

afterAll(() => {
  delete process.env.ENGY_DIR;
  resetDb();
});

function tinyModel(pieces: Record<string, number>): BpeModel {
  const scores = Object.values(pieces);
  return {
    pieceScores: new Map(Object.entries(pieces)),
    minNormalScore: Math.min(...scores),
    maxPieceLength: Math.max(...Object.keys(pieces).map((piece) => Array.from(piece).length)),
    addDummyPrefix: true,
    removeExtraWhitespaces: true,
    escapeWhitespaces: true,
  };
}

describe('keyword encoding', () => {
  describe('encodeToPieces', () => {
    it('should choose the highest-scoring segmentation, mirroring Unigram Viterbi', () => {
      const model = tinyModel({ '▁AB': -1, '▁A': -2, B: -2, '▁': -5, A: -5 });
      expect(encodeToPieces('ab', model)).toEqual(['▁AB']);
    });

    it('should uppercase input to match the training vocabulary casing', () => {
      const model = tinyModel({ '▁AB': -1 });
      expect(encodeToPieces('ab', model)).toEqual(['▁AB']);
    });

    it('should fall back to single characters when no larger piece matches', () => {
      const model = tinyModel({ '▁': -1, A: -2, B: -2 });
      expect(encodeToPieces('ab', model)).toEqual(['▁', 'A', 'B']);
    });

    it('should return an empty sequence when add_dummy_prefix is off and input is blank', () => {
      const model: BpeModel = { ...tinyModel({ '▁A': -1 }), addDummyPrefix: false };
      expect(encodeToPieces('   ', model)).toEqual([]);
    });
  });

  describe('formatKeywordLine', () => {
    it('should format tokens, boost, threshold and id in sherpa-onnx keywords-file order', () => {
      expect(formatKeywordLine(['▁E', 'NG', 'Y'], 'ENGY', { boost: 2, threshold: 0.35 })).toBe(
        '▁E NG Y :2 #0.35 @ENGY',
      );
    });

    it('should omit boost and threshold when not given', () => {
      expect(formatKeywordLine(['▁E', 'NG', 'Y'], 'ENGY')).toBe('▁E NG Y @ENGY');
    });
  });

  describe('against the real KWS model', () => {
    it(
      '[FR-TG2.11] should encode a known phrase to the exact token sequence sherpa-onnx ships',
      async () => {
        const kwsModelDir = await resolveKwsModelDir();
        const buffer = fs.readFileSync(path.join(kwsModelDir, 'bpe.model'));
        const model = parseBpeModel(buffer);

        // From the model's own shipped keywords_raw.txt / keywords.txt pair —
        // authoritative ground truth for what upstream's text2token.py produces.
        expect(encodeToPieces('HELLO WORLD', model)).toEqual(['▁HE', 'LL', 'O', '▁WORLD']);
        expect(encodeToPieces('HAPPY NEW YEAR', model)).toEqual([
          '▁HA',
          'PP',
          'Y',
          '▁NEW',
          '▁YEAR',
        ]);
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      `[FR-TG2.11] should encode the default wake word "${DEFAULT_WAKE_WORD}" into a keywords-file line`,
      async () => {
        const kwsModelDir = await resolveKwsModelDir();
        const line = await encodeWakeWord(DEFAULT_WAKE_WORD, kwsModelDir);
        expect(line).toBe('▁A NG I E @ANGIE');
      },
      MODEL_TEST_TIMEOUT,
    );

    it(
      'should reject a phrase containing a character the model has no token for',
      async () => {
        const kwsModelDir = await resolveKwsModelDir();
        await expect(encodeWakeWord('ENGY 42', kwsModelDir)).rejects.toThrow(/no token for/);
      },
      MODEL_TEST_TIMEOUT,
    );
  });
});
