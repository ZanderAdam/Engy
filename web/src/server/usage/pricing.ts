import { eq } from 'drizzle-orm';
import type { UsageModelRate } from '@engy/common';
import { getDb } from '../db/client';
import { usagePricing } from '../db/schema';

type Database = ReturnType<typeof getDb>;
// Callers pass either the top-level db handle or a `db.transaction((tx) => ...)`
// callback's `tx` — both support the same select/insert/update surface.
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Transaction;

// $-per-MTok has at most 2 decimal places, so ×100 always lands on an
// integer: micro-cents/token = $/MTok × 100 (1 cent = 1,000,000 micro-cents,
// 1 MTok = 1,000,000 tokens, the two million-factors cancel).
const DOLLARS_PER_MTOK_TO_MICRO_CENTS_PER_TOKEN = 100;

export const SEED_MODEL_RATES: UsageModelRate[] = [
  {
    model: 'claude-opus-5',
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheWrite1hPerMTok: 10.0,
    cacheWrite5mPerMTok: 6.25,
    cacheReadPerMTok: 0.5,
  },
  {
    model: 'claude-fable-5-1',
    inputPerMTok: 10.0,
    outputPerMTok: 50.0,
    cacheWrite1hPerMTok: 20.0,
    cacheWrite5mPerMTok: 12.5,
    cacheReadPerMTok: 0.25,
  },
  {
    model: 'claude-fable-5',
    inputPerMTok: 10.0,
    outputPerMTok: 50.0,
    cacheWrite1hPerMTok: 20.0,
    cacheWrite5mPerMTok: 12.5,
    cacheReadPerMTok: 1.0,
  },
  {
    model: 'claude-sonnet-5',
    inputPerMTok: 2.0,
    outputPerMTok: 10.0,
    cacheWrite1hPerMTok: 4.0,
    cacheWrite5mPerMTok: 2.5,
    cacheReadPerMTok: 0.2,
  },
  {
    model: 'claude-haiku-4-5',
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheWrite1hPerMTok: 2.0,
    cacheWrite5mPerMTok: 1.25,
    cacheReadPerMTok: 0.1,
  },
];

export interface ModelRateRow {
  model: string;
  inputMicroCentsPerToken: number;
  outputMicroCentsPerToken: number;
  cacheWrite1hMicroCentsPerToken: number;
  cacheWrite5mMicroCentsPerToken: number;
  cacheReadMicroCentsPerToken: number;
}

export interface UsageTokenBuckets {
  inputTokens: number;
  outputTokens: number;
  cacheWrite1hTokens: number;
  cacheWrite5mTokens: number;
  cacheReadTokens: number;
}

function toMicroCentsPerToken(dollarsPerMTok: number): number {
  return Math.round(dollarsPerMTok * DOLLARS_PER_MTOK_TO_MICRO_CENTS_PER_TOKEN);
}

// Idempotent: onConflictDoNothing so an already-edited rate (the table is
// "seeded but editable") survives across restarts instead of being reset.
export function seedUsagePricing(db: Db = getDb()): void {
  for (const rate of SEED_MODEL_RATES) {
    db.insert(usagePricing)
      .values({
        model: rate.model,
        inputMicroCentsPerToken: toMicroCentsPerToken(rate.inputPerMTok),
        outputMicroCentsPerToken: toMicroCentsPerToken(rate.outputPerMTok),
        cacheWrite1hMicroCentsPerToken: toMicroCentsPerToken(rate.cacheWrite1hPerMTok),
        cacheWrite5mMicroCentsPerToken: toMicroCentsPerToken(rate.cacheWrite5mPerMTok),
        cacheReadMicroCentsPerToken: toMicroCentsPerToken(rate.cacheReadPerMTok),
      })
      .onConflictDoNothing()
      .run();
  }
}

export function getModelRate(db: Db, model: string): ModelRateRow | undefined {
  return db.select().from(usagePricing).where(eq(usagePricing.model, model)).get();
}

export function listModelRates(db: Db): ModelRateRow[] {
  return db.select().from(usagePricing).all();
}

// Unknown models must render as unpriced with tokens still counted — never
// silently priced at zero, never priced with a guessed rate.
export function findUnpricedModels(db: Db, models: Iterable<string>): string[] {
  const priced = new Set(listModelRates(db).map((rate) => rate.model));
  return [...new Set(models)].filter((model) => !priced.has(model));
}

// Returns micro-cents, not cents — callers sum across buckets/rows and round
// to cents once at the API boundary so per-row rounding never compounds.
export function microCentsForTokens(buckets: UsageTokenBuckets, rate: ModelRateRow): number {
  return (
    buckets.inputTokens * rate.inputMicroCentsPerToken +
    buckets.outputTokens * rate.outputMicroCentsPerToken +
    buckets.cacheWrite1hTokens * rate.cacheWrite1hMicroCentsPerToken +
    buckets.cacheWrite5mTokens * rate.cacheWrite5mMicroCentsPerToken +
    buckets.cacheReadTokens * rate.cacheReadMicroCentsPerToken
  );
}

export function microCentsToCents(microCents: number): number {
  return Math.round(microCents / 1_000_000);
}
