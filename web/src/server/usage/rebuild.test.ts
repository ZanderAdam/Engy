import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import {
  usageCall,
  usageCause,
  usageContextItem,
  usageField,
  usageFile,
  usagePricing,
  usageScanFile,
  usageExpensiveCall,
  usageSealedDate,
  usageSession,
  usageSessionDaily,
  usageTool,
  tasks,
} from '../db/schema';
import { seedUsagePricing } from './pricing';
import { USAGE_REDUCER_VERSION, hasStaleReducerSeals, rebuildUsageHistory } from './rebuild';

function seedUsageHistory(ctx: TestContext) {
  ctx.db
    .insert(usageScanFile)
    .values({ path: '/home/u/.claude/projects/-repo/s1.jsonl', sizeBytes: 10, mtimeMs: 1 })
    .run();
  ctx.db
    .insert(usageSealedDate)
    .values({ date: '2024-01-09', reducerVersion: USAGE_REDUCER_VERSION })
    .run();
  ctx.db.insert(usageSession).values({ sessionId: 's1', slug: 'slug-a', model: 'claude-sonnet-5' }).run();
  ctx.db
    .insert(usageSessionDaily)
    .values({ date: '2024-01-09', sessionId: 's1', slug: 'slug-a', model: 'claude-sonnet-5' })
    .run();
  ctx.db.insert(usageTool).values({ date: '2024-01-09', sessionId: 's1', toolName: 'Read' }).run();
  ctx.db.insert(usageField).values({ date: '2024-01-09', sessionId: 's1', tool: 'Agent', field: 'prompt' }).run();
  ctx.db
    .insert(usageFile)
    .values({ date: '2024-01-09', sessionId: 's1', filePath: 'a.ts', tool: 'Read', ext: '.ts' })
    .run();
  ctx.db.insert(usageCause).values({ date: '2024-01-09', sessionId: 's1', kind: 'toolResult' }).run();
  ctx.db.insert(usageCall).values({ sessionId: 's1', callIndex: 0 }).run();
  ctx.db
    .insert(usageContextItem)
    .values({ date: '2024-01-09', sessionId: 's1', kind: 'skill_listing' })
    .run();
  ctx.db
    .insert(usageExpensiveCall)
    .values({ date: '2024-01-09', sessionId: 's1', callIndex: 3, tool: 'Read' })
    .run();
}

describe('usage rebuild', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('hasStaleReducerSeals', () => {
    it('[FR-USAGE-260] should return true when a sealed date carries another reducer version', () => {
      seedUsageHistory(ctx);
      ctx.db
        .insert(usageSealedDate)
        .values({ date: '2024-01-08', reducerVersion: USAGE_REDUCER_VERSION - 1 })
        .run();

      expect(hasStaleReducerSeals(ctx.db)).toBe(true);
    });

    it('[FR-USAGE-260] should return false when every seal matches the current version', () => {
      seedUsageHistory(ctx);

      expect(hasStaleReducerSeals(ctx.db)).toBe(false);
    });

    it('should return false on a fresh install with no sealed dates yet', () => {
      expect(hasStaleReducerSeals(ctx.db)).toBe(false);
    });
  });

  describe('rebuildUsageHistory', () => {
    it('[FR-USAGE-360] should clear the scan bookkeeping and keep every rollup row', () => {
      seedUsageHistory(ctx);
      seedUsagePricing(ctx.db);
      ctx.db.insert(tasks).values({ title: 'unrelated task' }).run();

      rebuildUsageHistory(ctx.db);

      expect(ctx.db.select().from(usageScanFile).all()).toHaveLength(0);
      expect(ctx.db.select().from(usageSealedDate).all()).toHaveLength(0);
      expect(ctx.db.select().from(usageSession).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageSessionDaily).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageTool).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageField).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageFile).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageCause).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageCall).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageContextItem).all()).toHaveLength(1);
      expect(ctx.db.select().from(usageExpensiveCall).all()).toHaveLength(1);
      expect(ctx.db.select().from(usagePricing).all().length).toBeGreaterThan(0);
      expect(ctx.db.select().from(tasks).all()).toHaveLength(1);
    });
  });
});
