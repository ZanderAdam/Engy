import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { usagePricing } from '../db/schema';
import {
  seedUsagePricing,
  normaliseModelId,
  listModelRates,
  microCentsForTokens,
  microCentsToCents,
  getRatesMap,
  rateFor,
  SEED_MODEL_RATES,
} from './pricing';

function rateOf(ctx: TestContext, model: string) {
  const rate = listModelRates(ctx.db).find((row) => row.model === model);
  if (!rate) throw new Error(`no seeded rate for ${model}`);
  return rate;
}

describe('usage pricing', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('seedUsagePricing', () => {
    it('[FR-USAGE-160] should insert every seed model rate as exact integer micro-cents', () => {
      seedUsagePricing(ctx.db);

      const rows = listModelRates(ctx.db);
      expect(rows).toHaveLength(SEED_MODEL_RATES.length);

      const opus = rateOf(ctx, 'claude-opus-5');
      expect(opus.inputMicroCentsPerToken).toBe(500);
      expect(opus.outputMicroCentsPerToken).toBe(2500);
      expect(opus.cacheWrite1hMicroCentsPerToken).toBe(1000);
      expect(opus.cacheWrite5mMicroCentsPerToken).toBe(625);
      expect(opus.cacheReadMicroCentsPerToken).toBe(50);

      // Fable 5.1 is the 0.025x cache-read exception, not the general 0.1x rule.
      const fable51 = rateOf(ctx, 'claude-fable-5-1');
      expect(fable51.cacheReadMicroCentsPerToken).toBe(25);
      const fable5 = rateOf(ctx, 'claude-fable-5');
      expect(fable5.cacheReadMicroCentsPerToken).toBe(100);

      const opus55 = rateOf(ctx, 'claude-opus-5-5');
      expect(opus55.inputMicroCentsPerToken).toBe(400);
      expect(opus55.outputMicroCentsPerToken).toBe(2000);
      expect(opus55.cacheWrite1hMicroCentsPerToken).toBe(800);
      expect(opus55.cacheWrite5mMicroCentsPerToken).toBe(500);
      expect(opus55.cacheReadMicroCentsPerToken).toBe(20);
    });

    it('[FR-USAGE-160] should never overwrite an already-edited rate on reseed', () => {
      seedUsagePricing(ctx.db);
      ctx.db
        .update(usagePricing)
        .set({ inputMicroCentsPerToken: 999 })
        .where(eq(usagePricing.model, 'claude-sonnet-5'))
        .run();

      seedUsagePricing(ctx.db);

      const rate = rateOf(ctx, 'claude-sonnet-5');
      expect(rate.inputMicroCentsPerToken).toBe(999);
    });
  });

  describe('normaliseModelId', () => {
    it('[FR-USAGE-150] should strip a dated snapshot suffix so it resolves to the base model', () => {
      expect(normaliseModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    });

    it('[FR-USAGE-150] should leave an id that carries no date alone', () => {
      expect(normaliseModelId('claude-sonnet-5')).toBe('claude-sonnet-5');
      expect(normaliseModelId('<synthetic>')).toBe('<synthetic>');
    });
  });

  describe('rateFor', () => {
    it('[FR-USAGE-150] should price a dated snapshot of a priced model at the base rate', () => {
      seedUsagePricing(ctx.db);
      const rates = getRatesMap(ctx.db);
      expect(rateFor(rates, 'claude-haiku-4-5-20251001')?.model).toBe('claude-haiku-4-5');
      expect(rateFor(rates, '<synthetic>')).toBeUndefined();
    });
  });

  describe('microCentsForTokens', () => {
    it('[FR-USAGE-130] should sum every bucket against its own rate', () => {
      seedUsagePricing(ctx.db);
      const rate = rateOf(ctx, 'claude-sonnet-5');
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
    it('[FR-USAGE-130] should round to the nearest integer cent, never fractional', () => {
      expect(microCentsToCents(1_500_000)).toBe(2);
      expect(microCentsToCents(1_499_999)).toBe(1);
      expect(Number.isInteger(microCentsToCents(333_333))).toBe(true);
    });
  });
});
