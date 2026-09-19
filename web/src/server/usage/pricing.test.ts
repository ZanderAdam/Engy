import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { usagePricing } from '../db/schema';
import {
  seedUsagePricing,
  getModelRate,
  listModelRates,
  findUnpricedModels,
  microCentsForTokens,
  microCentsToCents,
  SEED_MODEL_RATES,
} from './pricing';

describe('usage pricing', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('seedUsagePricing', () => {
    it('should insert every seed model rate as exact integer micro-cents', () => {
      seedUsagePricing(ctx.db);

      const rows = listModelRates(ctx.db);
      expect(rows).toHaveLength(SEED_MODEL_RATES.length);

      const opus = getModelRate(ctx.db, 'claude-opus-5')!;
      expect(opus.inputMicroCentsPerToken).toBe(500);
      expect(opus.outputMicroCentsPerToken).toBe(2500);
      expect(opus.cacheWrite1hMicroCentsPerToken).toBe(1000);
      expect(opus.cacheWrite5mMicroCentsPerToken).toBe(625);
      expect(opus.cacheReadMicroCentsPerToken).toBe(50);

      // Fable 5.1 is the 0.025x cache-read exception, not the general 0.1x rule.
      const fable51 = getModelRate(ctx.db, 'claude-fable-5-1')!;
      expect(fable51.cacheReadMicroCentsPerToken).toBe(25);
      const fable5 = getModelRate(ctx.db, 'claude-fable-5')!;
      expect(fable5.cacheReadMicroCentsPerToken).toBe(100);
    });

    it('should never overwrite an already-edited rate on reseed', () => {
      seedUsagePricing(ctx.db);
      ctx.db
        .update(usagePricing)
        .set({ inputMicroCentsPerToken: 999 })
        .where(eq(usagePricing.model, 'claude-sonnet-5'))
        .run();

      seedUsagePricing(ctx.db);

      const rate = getModelRate(ctx.db, 'claude-sonnet-5')!;
      expect(rate.inputMicroCentsPerToken).toBe(999);
    });
  });

  describe('getModelRate', () => {
    it('should return undefined for a model with no pricing row', () => {
      seedUsagePricing(ctx.db);
      expect(getModelRate(ctx.db, 'claude-unknown-9')).toBeUndefined();
    });
  });

  describe('findUnpricedModels', () => {
    it('should list only models absent from usagePricing, never guessing a rate', () => {
      seedUsagePricing(ctx.db);
      const unpriced = findUnpricedModels(ctx.db, ['claude-sonnet-5', 'claude-unknown-9', 'claude-another-1']);
      expect(unpriced.sort()).toEqual(['claude-another-1', 'claude-unknown-9']);
    });

    it('should return an empty list when every model is priced', () => {
      seedUsagePricing(ctx.db);
      expect(findUnpricedModels(ctx.db, ['claude-sonnet-5', 'claude-opus-5'])).toEqual([]);
    });
  });

  describe('microCentsForTokens', () => {
    it('should sum every bucket against its own rate', () => {
      seedUsagePricing(ctx.db);
      const rate = getModelRate(ctx.db, 'claude-sonnet-5')!;
      const microCents = microCentsForTokens(
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheWrite1hTokens: 1_000_000,
          cacheWrite5mTokens: 1_000_000,
          cacheReadTokens: 1_000_000,
        },
        rate,
      );
      // 1 MTok of each bucket at sonnet rates: $2 + $10 + $4 + $2.50 + $0.20 = $18.70 = 1,870,000,000 micro-cents.
      expect(microCents).toBe(1_870_000_000);
      expect(microCentsToCents(microCents)).toBe(1870);
    });
  });

  describe('microCentsToCents', () => {
    it('should round to the nearest integer cent, never fractional', () => {
      expect(microCentsToCents(1_500_000)).toBe(2);
      expect(microCentsToCents(1_499_999)).toBe(1);
      expect(Number.isInteger(microCentsToCents(333_333))).toBe(true);
    });
  });
});
