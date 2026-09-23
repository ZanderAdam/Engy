import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { UsageSessionScanResult } from '@engy/common';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import {
  usageSession,
  usageSessionDaily,
  usageTool,
  usageField,
  usageFile,
  usageCause,
  usageCall,
  usageExpensiveCall,
  usageSealedDate,
  workspaces,
} from '../../db/schema';
import { seedUsagePricing } from '../../usage/pricing';
import { USAGE_REDUCER_VERSION } from '../../usage/rebuild';
import { refreshUsage } from '../../usage/ingest';

// ── Fixtures ─────────────────────────────────────────────────────────

function seedSession(ctx: TestContext, overrides: Partial<typeof usageSession.$inferInsert> = {}) {
  ctx.db
    .insert(usageSession)
    .values({
      sessionId: 's1',
      slug: 'slug-a',
      model: 'claude-sonnet-5',
      startedAt: '2024-01-10T10:00:00.000Z',
      ...overrides,
    })
    .run();
}

function seedDaily(ctx: TestContext, overrides: Partial<typeof usageSessionDaily.$inferInsert> = {}) {
  ctx.db
    .insert(usageSessionDaily)
    .values({
      date: '2024-01-10',
      sessionId: 's1',
      slug: 'slug-a',
      model: 'claude-sonnet-5',
      ...overrides,
    })
    .run();
}

function seedTool(ctx: TestContext, overrides: Partial<typeof usageTool.$inferInsert> = {}) {
  ctx.db
    .insert(usageTool)
    .values({
      date: '2024-01-10',
      sessionId: 's1',
      toolName: 'Read',
      ...overrides,
    })
    .run();
}

function seedField(ctx: TestContext, overrides: Partial<typeof usageField.$inferInsert> = {}) {
  ctx.db
    .insert(usageField)
    .values({
      date: '2024-01-10',
      sessionId: 's1',
      tool: 'Agent',
      field: 'prompt',
      ...overrides,
    })
    .run();
}

function seedFile(ctx: TestContext, overrides: Partial<typeof usageFile.$inferInsert> = {}) {
  ctx.db
    .insert(usageFile)
    .values({
      date: '2024-01-10',
      sessionId: 's1',
      filePath: 'src/index.ts',
      tool: 'Read',
      ext: '.ts',
      ...overrides,
    })
    .run();
}

function seedExpensiveCall(ctx: TestContext, overrides: Partial<typeof usageExpensiveCall.$inferInsert> = {}) {
  ctx.db
    .insert(usageExpensiveCall)
    .values({
      date: '2024-01-10',
      sessionId: 's1',
      callIndex: 0,
      tool: 'Write',
      ...overrides,
    })
    .run();
}

function seedCause(ctx: TestContext, overrides: Partial<typeof usageCause.$inferInsert> = {}) {
  ctx.db
    .insert(usageCause)
    .values({
      date: '2024-01-10',
      sessionId: 's1',
      kind: 'toolResult',
      ...overrides,
    })
    .run();
}

function seedCall(ctx: TestContext, overrides: Partial<typeof usageCall.$inferInsert> = {}) {
  ctx.db
    .insert(usageCall)
    .values({
      sessionId: 's1',
      callIndex: 0,
      ...overrides,
    })
    .run();
}

// ── Daemon stub ───────────────────────────────────────────────────────

interface DaemonMessage {
  type: string;
  payload: { requestId: string } & Record<string, unknown>;
}

function makeScanResult(overrides: Partial<UsageSessionScanResult['scan']['session']> = {}): UsageSessionScanResult {
  return {
    scan: {
      session: {
        sessionId: 'scan-1',
        slug: 'slug-scan',
        cwd: '/repo',
        gitBranch: 'main',
        model: 'claude-sonnet-5',
        startedAt: '2024-01-10T10:00:00.000Z',
        startedDate: '2024-01-10',
        endedAt: '2024-01-10T11:00:00.000Z',
        apiCalls: 2,
        agentCalls: 0,
        inputTokens: 100,
        outputTokens: 200,
        thinkingTokens: 10,
        cacheReadTokens: 1000,
        cacheWrite1hTokens: 500,
        cacheWrite5mTokens: 0,
        webSearchRequests: 0,
        webFetchRequests: 0,
        parentSessionId: null,
        isSubagent: false,
        agentType: null,
        agentDescription: null,
        ...overrides,
      },
      days: [
        {
          date: '2024-01-10',
          model: 'claude-sonnet-5',
          apiCalls: 2,
          inputTokens: 100,
          outputTokens: 200,
          thinkingTokens: 10,
          cacheReadTokens: 1000,
          cacheWrite1hTokens: 500,
          cacheWrite5mTokens: 0,
          webSearchRequests: 0,
          webFetchRequests: 0,
        },
      ],
      tools: [
        {
          date: '2024-01-10',
          tool: 'Read',
          resultChars: 500,
          inputChars: 50,
          images: 0,
          errors: 0,
          maxResultChars: 500,
          p50ResultChars: 150,
          p95ResultChars: 500,
          tokens: 200,
          tokenTurns: 400,
          calls: 3,
        },
      ],
      fields: [{ date: '2024-01-10', tool: 'Agent', field: 'prompt', tokens: 80, tokenTurns: 160, calls: 1 }],
      files: [
        {
          date: '2024-01-10',
          filePath: 'src/index.ts',
          ext: '.ts',
          reads: 2,
          edits: 0,
          writes: 0,
          totalChars: 720,
          tokens: 150,
          tokenTurns: 300,
          calls: 2,
        },
      ],
      causes: [
        { date: '2024-01-10', kind: 'toolResult', tokenTurns: 400 },
        { date: '2024-01-10', kind: 'toolInput', tokenTurns: 160 },
        { date: '2024-01-10', kind: 'text', tokenTurns: 40 },
      ],
      calls: [
        { callIndex: 0, cacheReadTokens: 100 },
        { callIndex: 1, cacheReadTokens: 900 },
      ],
      expensiveCalls: [
        {
          date: '2024-01-10',
          sessionId: 'scan-1',
          tool: 'Read',
          field: 'file_path',
          tokens: 200,
          tokenTurns: 400,
          callIndex: 1,
          preview: 'src/index.ts',
        },
      ],
      compactions: 2,
      bytesScanned: 1000,
      linesParsed: 10,
      linesSkipped: 5,
    },
    repoRoot: '/repo',
    isFullParse: true,
    meta: {
      durationMinutes: 12.5,
      firstPrompt: 'Fix the flaky test',
      linesAdded: 10,
      linesRemoved: 2,
      filesModified: 1,
      gitCommits: 1,
      toolErrors: 0,
    },
  };
}

function installFakeUsageDaemon(
  ctx: TestContext,
  respond: () => { sessions: UsageSessionScanResult[]; files: Record<string, never>; newlySealedDates: string[]; staleSealSkips: number },
) {
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as DaemonMessage;
      if (msg.type !== 'USAGE_SCAN_REQUEST') return;
      queueMicrotask(() => {
        const pending = ctx.state.pendingUsageScan.get(msg.payload.requestId);
        if (!pending) return;
        ctx.state.pendingUsageScan.delete(msg.payload.requestId);
        pending.resolve({ requestId: msg.payload.requestId, ...respond() } as never);
      });
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
}

function installTrackingUsageDaemon(
  ctx: TestContext,
  respond: () => { sessions: UsageSessionScanResult[]; files: Record<string, never>; newlySealedDates: string[]; staleSealSkips: number },
) {
  const requests: Array<{ since?: string }> = [];
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as DaemonMessage;
      if (msg.type !== 'USAGE_SCAN_REQUEST') return;
      requests.push({ since: msg.payload.since as string | undefined });
      queueMicrotask(() => {
        const pending = ctx.state.pendingUsageScan.get(msg.payload.requestId);
        if (!pending) return;
        ctx.state.pendingUsageScan.delete(msg.payload.requestId);
        pending.resolve({ requestId: msg.payload.requestId, ...respond() } as never);
      });
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
  return requests;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('usage router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    seedUsagePricing(ctx.db);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('overview', () => {
    it('[FR-USAGE-170] should split a session crossing midnight across its two dates', async () => {
      seedDaily(ctx, { date: '2024-01-10', inputTokens: 1000 });
      seedDaily(ctx, { date: '2024-01-11', inputTokens: 2000 });

      const onlyFirstDay = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });
      expect(onlyFirstDay.totals.inputTokens).toBe(1000);

      const bothDays = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-11' });
      expect(bothDays.totals.inputTokens).toBe(3000);
    });

    it('[FR-USAGE-270] should compare against the immediately preceding window of equal length', async () => {
      // Current window: 2024-01-10..2024-01-11 (2 days). Previous: 2024-01-08..2024-01-09.
      seedDaily(ctx, { date: '2024-01-08', inputTokens: 1_000_000 });
      seedDaily(ctx, { date: '2024-01-09', inputTokens: 1_000_000 });
      seedDaily(ctx, { date: '2024-01-10', inputTokens: 500_000 });
      seedDaily(ctx, { date: '2024-01-11', inputTokens: 500_000 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-11' });

      // sonnet input rate = $2/MTok; previous window sums 2,000,000 tokens -> $4.00 -> 400 cents.
      expect(overview.previous.total).toBe(400);
      expect(overview.previous.input).toBe(400);
      expect(overview.previous.output).toBe(0);
      expect(overview.previous.cacheWrite).toBe(0);
      expect(overview.previous.cacheRead).toBe(0);
      // current window sums 1,000,000 tokens -> $2.00 -> 200 cents.
      expect(overview.cost.total).toBe(200);
    });

    it('[FR-USAGE-140] should mark an unrecognised model as unpriced while still counting its tokens', async () => {
      seedDaily(ctx, { date: '2024-01-10', model: 'claude-unknown-9', inputTokens: 500, cacheReadTokens: 200 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      expect(overview.totals.inputTokens).toBe(500);
      expect(overview.unpricedModels).toContain('claude-unknown-9');
      expect(overview.cost.total).toBe(0);
    });

    it('[FR-USAGE-110] should cost each cause directly (not scaled) and fold the shortfall into baseline', async () => {
      // sonnet cache-read rate = $0.20/MTok = 20 micro-cents/token.
      seedSession(ctx, { sessionId: 's1', model: 'claude-sonnet-5' });
      seedDaily(ctx, { date: '2024-01-10', cacheReadTokens: 1_000_000 }); // measured = 20¢
      seedCause(ctx, { kind: 'toolResult', tokenTurns: 300_000 }); // 6,000,000µ¢ = 6¢
      seedCause(ctx, { kind: 'toolInput', tokenTurns: 150_000 }); // 3,000,000µ¢ = 3¢
      seedCause(ctx, { kind: 'text', tokenTurns: 50_000 }); // 1,000,000µ¢ = 1¢

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      expect(overview.cost.cacheRead).toBe(20);
      expect(overview.causes.toolResult).toBe(6);
      expect(overview.causes.toolInput).toBe(3);
      expect(overview.causes.text).toBe(1);
      expect(overview.causes.baseline).toBe(10);
      const sum =
        overview.causes.toolResult +
        overview.causes.toolInput +
        overview.causes.text +
        overview.causes.image +
        overview.causes.thinking +
        overview.causes.baseline;
      expect(sum).toBe(overview.cost.cacheRead);
    });

    it('[FR-USAGE-120] should keep the six causes summing to measured cache-read cost across several sessions', async () => {
      // Causes aggregate every session in range, so the measured side has to
      // carry every session's daily row too — one lost row and baseline is
      // floored to 0 while the attributed causes overshoot the total.
      for (const sessionId of ['s1', 's2', 's3']) {
        seedSession(ctx, { sessionId, model: 'claude-sonnet-5' });
        seedDaily(ctx, { date: '2024-01-10', sessionId, cacheReadTokens: 1_000_000 });
        seedCause(ctx, { date: '2024-01-10', sessionId, kind: 'toolResult', tokenTurns: 200_000 });
        seedCause(ctx, { date: '2024-01-10', sessionId, kind: 'toolInput', tokenTurns: 100_000 });
      }

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      const sum =
        overview.causes.toolResult +
        overview.causes.toolInput +
        overview.causes.text +
        overview.causes.image +
        overview.causes.thinking +
        overview.causes.baseline;
      expect(overview.cost.cacheRead).toBe(60);
      expect(sum).toBe(overview.cost.cacheRead);
      expect(overview.causes.baseline).toBeGreaterThan(0);
    });

    it('[FR-USAGE-120] should never let baseline go negative when attribution exceeds a short session\'s measured cost', async () => {
      seedSession(ctx, { sessionId: 's1', model: 'claude-sonnet-5' });
      // measured: 30,000 tokens * 20µ¢ = 600,000µ¢ -> rounds to 1¢.
      seedDaily(ctx, { date: '2024-01-10', cacheReadTokens: 30_000 });
      // attributed: 1,000,000 tokens * 20µ¢ = 20,000,000µ¢ = 20¢ — far more than measured.
      seedCause(ctx, { kind: 'toolResult', tokenTurns: 1_000_000 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      expect(overview.cost.cacheRead).toBe(1);
      expect(overview.causes.toolResult).toBe(20);
      expect(overview.causes.baseline).toBe(0);
    });

    it('[FR-USAGE-110] should ignore a cause row whose kind is unrecognised', async () => {
      seedSession(ctx, { sessionId: 's1', model: 'claude-sonnet-5' });
      seedDaily(ctx, { date: '2024-01-10', cacheReadTokens: 1_000_000 });
      seedCause(ctx, { kind: 'toolResult', tokenTurns: 100_000 });
      // A kind the enum doesn't list — e.g. from a reducer version this
      // router predates. The DB column has no CHECK constraint enforcing it.
      ctx.db
        .insert(usageCause)
        .values({ date: '2024-01-10', sessionId: 's1', kind: 'unknownKind' as any, tokenTurns: 500_000 })
        .run();

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      for (const value of Object.values(overview.causes)) {
        expect(Number.isNaN(value)).toBe(false);
      }
      expect(overview.causes.toolResult).toBe(2);
    });

    it('[FR-USAGE-130] should never return a fractional cent anywhere in the response', async () => {
      seedDaily(ctx, {
        date: '2024-01-10',
        inputTokens: 333,
        outputTokens: 777,
        cacheWrite1hTokens: 111,
        cacheReadTokens: 999,
      });
      seedCause(ctx, { kind: 'toolResult', tokenTurns: 37 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      for (const value of [
        overview.cost.input,
        overview.cost.output,
        overview.cost.cacheWrite,
        overview.cost.cacheRead,
        overview.cost.total,
        overview.cost.subagentCost,
        overview.previous.total,
        ...Object.values(overview.causes),
      ]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    it('[FR-USAGE-150] should price a dated model id at the base model rate, not report it unpriced', async () => {
      // Transcripts stamp a dated snapshot id for a model the rate table lists undated.
      seedDaily(ctx, { date: '2024-01-10', model: 'claude-haiku-4-5-20251001', inputTokens: 1_000_000 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      // haiku-4-5 input rate $1/MTok: 1M tokens = $1.00 = 100¢.
      expect(overview.unpricedModels).toEqual([]);
      expect(overview.cost.total).toBe(100);
    });

    it('[FR-USAGE-110] [FR-USAGE-120] should scope causes by sessionId like every other endpoint, not by slug', async () => {
      // Two sessions share a slug but only one belongs to the workspace — a
      // repo added to a workspace after older sessions were scanned leaves
      // those sessions at engyWorkspaceId: null. Scoping daily rows by slug
      // while scoping cause rows by sessionId pulls the out-of-scope
      // session's tokens into totals but drops its causes, so the shortfall
      // lands entirely in baseline.
      const ws = ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws' }).returning().get();
      seedSession(ctx, { sessionId: 'in-scope', slug: 'shared', engyWorkspaceId: ws.id });
      seedSession(ctx, { sessionId: 'out-of-scope', slug: 'shared', engyWorkspaceId: null });
      seedDaily(ctx, { sessionId: 'in-scope', slug: 'shared', cacheReadTokens: 1_000_000_000 });
      seedDaily(ctx, { sessionId: 'out-of-scope', slug: 'shared', cacheReadTokens: 1_000_000_000 });
      seedCause(ctx, { sessionId: 'in-scope', kind: 'toolResult', tokenTurns: 1_000_000_000 });
      seedCause(ctx, { sessionId: 'out-of-scope', kind: 'toolResult', tokenTurns: 1_000_000_000 });

      const overview = await caller.usage.overview({ workspaceId: ws.id, from: '2024-01-10', to: '2024-01-10' });

      expect(overview.totals.cacheReadTokens).toBe(1_000_000_000);
      expect(overview.causes.toolResult).toBe(overview.cost.cacheRead);
      expect(overview.causes.baseline).toBe(0);
    });

    it('[FR-USAGE-370] should include a session with no resolved workspace when no scope filter is applied', async () => {
      const ws = ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws' }).returning().get();
      seedSession(ctx, { sessionId: 'in-workspace', engyWorkspaceId: ws.id });
      seedSession(ctx, { sessionId: 'unresolved', engyWorkspaceId: null });
      seedDaily(ctx, { sessionId: 'in-workspace', inputTokens: 1_000_000 });
      seedDaily(ctx, { sessionId: 'unresolved', inputTokens: 1_000_000 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      // sonnet input rate $2/MTok: each session contributes 1M tokens = $2.00 = 200¢.
      expect(overview.totals.inputTokens).toBe(2_000_000);
      expect(overview.cost.total).toBe(400);
    });

    it('[FR-USAGE-330] should include subagent spend in cost.total and report it as its own share', async () => {
      seedDaily(ctx, { date: '2024-01-10', sessionId: 'main', isSubagent: false, inputTokens: 1_000_000 });
      seedDaily(ctx, { date: '2024-01-10', sessionId: 'agent-1', isSubagent: true, inputTokens: 3_000_000 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      // sonnet input rate $2/MTok: main = 1M tokens = $2.00 = 200¢; sub = 3M tokens = $6.00 = 600¢.
      expect(overview.cost.total).toBe(800);
      expect(overview.cost.subagentCost).toBe(600);
      expect(overview.subagentShare).toBeCloseTo(600 / 800);
    });

    it('should count totals.sessions on a session\'s local start date, not the UTC date sliced from startedAt', async () => {
      // UTC date is 2024-01-11 (02:00Z) but the daemon recorded a local date
      // of 2024-01-10 — a timezone behind UTC crossing midnight.
      seedSession(ctx, {
        sessionId: 'local-boundary',
        startedAt: '2024-01-11T02:00:00.000Z',
        startedDate: '2024-01-10',
      });
      seedDaily(ctx, { sessionId: 'local-boundary', date: '2024-01-10' });

      const localDay = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });
      expect(localDay.totals.sessions).toBe(1);

      const utcDay = await caller.usage.overview({ from: '2024-01-11', to: '2024-01-11' });
      expect(utcDay.totals.sessions).toBe(0);
    });
  });

  describe('date range validation', () => {
    it('should reject a malformed from/to date instead of crashing on Invalid time value', async () => {
      await expect(caller.usage.overview({ from: 'not-a-date', to: '2024-01-10' })).rejects.toThrow();
    });

    it('should reject a from date that is after the to date', async () => {
      await expect(caller.usage.overview({ from: '2024-01-11', to: '2024-01-10' })).rejects.toThrow();
    });

    it('should reject a limit outside 1-200', async () => {
      await expect(caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 0 })).rejects.toThrow();
      await expect(caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 500 })).rejects.toThrow();
    });
  });

  describe('tools', () => {
    it('[FR-USAGE-280] should sort tools by their directly attributed cost descending', async () => {
      seedTool(ctx, { toolName: 'Read', attributedCostMicroCents: 16_000_000, calls: 4 });
      seedTool(ctx, { toolName: 'Bash', attributedCostMicroCents: 4_000_000, calls: 10 });

      const tools = await caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(tools.map((t) => t.tool)).toEqual(['Read', 'Bash']);
      expect(tools[0].costCents).toBe(16);
      expect(tools[0].costPerCallCents).toBe(4);
    });

    it('[FR-USAGE-170] should bucket each tool call under its own date for a session spanning midnight', async () => {
      const scan = makeScanResult({
        sessionId: 'midnight-1',
        startedAt: '2024-01-10T23:30:00.000Z',
        endedAt: '2024-01-11T00:30:00.000Z',
      });
      scan.scan.tools = [
        {
          date: '2024-01-10',
          tool: 'Read',
          resultChars: 100,
          inputChars: 10,
          images: 0,
          errors: 0,
          maxResultChars: 100,
          p50ResultChars: 100,
          p95ResultChars: 100,
          tokens: 50,
          tokenTurns: 100,
          calls: 1,
        },
        {
          date: '2024-01-11',
          tool: 'Bash',
          resultChars: 200,
          inputChars: 20,
          images: 0,
          errors: 0,
          maxResultChars: 200,
          p50ResultChars: 200,
          p95ResultChars: 200,
          tokens: 80,
          tokenTurns: 160,
          calls: 2,
        },
      ];
      scan.scan.expensiveCalls = [];
      scan.scan.days = [
        {
          date: '2024-01-10',
          model: 'claude-sonnet-5',
          apiCalls: 1,
          inputTokens: 50,
          outputTokens: 50,
          thinkingTokens: 0,
          cacheReadTokens: 500,
          cacheWrite1hTokens: 0,
          cacheWrite5mTokens: 0,
          webSearchRequests: 0,
          webFetchRequests: 0,
        },
        {
          date: '2024-01-11',
          model: 'claude-sonnet-5',
          apiCalls: 2,
          inputTokens: 50,
          outputTokens: 150,
          thinkingTokens: 10,
          cacheReadTokens: 500,
          cacheWrite1hTokens: 500,
          cacheWrite5mTokens: 0,
          webSearchRequests: 0,
          webFetchRequests: 0,
        },
      ];

      installFakeUsageDaemon(ctx, () => ({
        sessions: [scan],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();

      const day1 = await caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 10 });
      const day2 = await caller.usage.tools({ from: '2024-01-11', to: '2024-01-11', limit: 10 });
      const bothDays = await caller.usage.tools({ from: '2024-01-10', to: '2024-01-11', limit: 10 });

      expect(day1.map((t) => t.tool)).toEqual(['Read']);
      expect(day2.map((t) => t.tool)).toEqual(['Bash']);
      expect(bothDays.map((t) => t.tool).sort()).toEqual(['Bash', 'Read']);
    });

    it('[FR-USAGE-400] should surface the reducer-computed p50/p95 result size, not zero', async () => {
      seedTool(ctx, { toolName: 'Read', calls: 4, p50ResultChars: 300, p95ResultChars: 900 });

      const tools = await caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(tools[0]).toMatchObject({ p50ResultChars: 300, p95ResultChars: 900 });
    });
  });

  describe('fields', () => {
    it('[FR-USAGE-290] should aggregate cost by tool.field', async () => {
      seedField(ctx, { tool: 'Agent', field: 'prompt', attributedCostMicroCents: 14_000_000, tokens: 300 });
      seedField(ctx, { tool: 'Bash', field: 'command', attributedCostMicroCents: 6_000_000, tokens: 100 });

      const fields = await caller.usage.fields({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(fields[0]).toMatchObject({ tool: 'Agent', field: 'prompt', costCents: 14 });
      expect(fields[1]).toMatchObject({ tool: 'Bash', field: 'command', costCents: 6 });
    });

    it('[FR-USAGE-290] should sum many sub-cent rows sharing a tool.field before rounding, not round each to 0 first', async () => {
      // Each row is 0.3¢ — rounding per row (the old behaviour) floors every
      // one of them to 0, and summing thirty zeros stays 0 regardless of how
      // many rows there are.
      for (let i = 0; i < 30; i += 1) {
        seedField(ctx, {
          sessionId: `s-${i}`,
          tool: 'Bash',
          field: 'command',
          attributedCostMicroCents: 3_000,
          tokens: 10,
        });
      }

      const fields = await caller.usage.fields({ from: '2024-01-10', to: '2024-01-10', limit: 50 });

      // 30 rows * 3,000 micro-cents = 90,000 micro-cents = 0.09¢ -> still 0.
      expect(fields.find((f) => f.tool === 'Bash' && f.field === 'command')?.costCents ?? 0).toBe(0);

      for (let i = 30; i < 200; i += 1) {
        seedField(ctx, {
          sessionId: `s-${i}`,
          tool: 'Bash',
          field: 'command',
          attributedCostMicroCents: 3_000,
          tokens: 10,
        });
      }

      const withMoreRows = await caller.usage.fields({ from: '2024-01-10', to: '2024-01-10', limit: 50 });
      const commandRow = withMoreRows.find((f) => f.tool === 'Bash' && f.field === 'command');
      // 200 rows * 3,000 micro-cents = 600,000 micro-cents = 0.6¢ -> rounds to
      // 1¢ once the whole group is summed — impossible if each row rounded
      // to 0 before being added up.
      expect(commandRow?.costCents).toBe(1);
    });

    it('should surface the reducer-computed call count, not zero', async () => {
      seedField(ctx, { tool: 'Agent', field: 'prompt', calls: 2 });
      seedField(ctx, { sessionId: 's2', tool: 'Agent', field: 'prompt', calls: 3 });

      const fields = await caller.usage.fields({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(fields.find((f) => f.tool === 'Agent' && f.field === 'prompt')?.calls).toBe(5);
    });
  });

  describe('files', () => {
    it('[FR-USAGE-300] should group by extension when groupBy is ext', async () => {
      seedFile(ctx, { filePath: 'a.ts', ext: '.ts', attributedCostMicroCents: 8_000_000, tokensEst: 100 });
      seedFile(ctx, { filePath: 'b.ts', ext: '.ts', attributedCostMicroCents: 4_000_000, tokensEst: 50 });
      seedFile(ctx, { filePath: 'c.md', ext: '.md', attributedCostMicroCents: 5_000_000, tokensEst: 80 });

      const files = await caller.usage.files({ from: '2024-01-10', to: '2024-01-10', limit: 10, groupBy: 'ext' });

      const ts = files.find((f) => f.key === '.ts')!;
      expect(ts.tokens).toBe(150);
      expect(ts.costCents).toBe(12);
    });

    it('should surface the reducer-computed character count, not zero', async () => {
      seedFile(ctx, { filePath: 'a.ts', ext: '.ts', totalChars: 1200 });

      const files = await caller.usage.files({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(files.find((f) => f.key === 'a.ts')?.totalChars).toBe(1200);
    });
  });

  describe('expensiveCalls', () => {
    it('[FR-USAGE-350] should return the top calls sorted by token-turns descending', async () => {
      seedExpensiveCall(ctx, { callIndex: 0, tool: 'Write', tokenTurns: 500, preview: 'small.ts' });
      seedExpensiveCall(ctx, { callIndex: 1, tool: 'Write', tokenTurns: 5_000, preview: 'big.ts' });

      const calls = await caller.usage.expensiveCalls({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(calls.map((c) => c.preview)).toEqual(['big.ts', 'small.ts']);
    });

    it('should convert the stored attributed cost to cents, like the other rollups', async () => {
      seedExpensiveCall(ctx, { attributedCostMicroCents: 20_000_000 });

      const calls = await caller.usage.expensiveCalls({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(calls[0].costCents).toBe(20);
    });
  });

  describe('sessions', () => {
    it('[FR-USAGE-060] should roll a subagent child cost into its parent row', async () => {
      seedSession(ctx, { sessionId: 'p1', isSubagent: false, estCostCents: 100, apiCalls: 5 });
      seedSession(ctx, {
        sessionId: 'c1',
        parentSessionId: 'p1',
        isSubagent: true,
        estCostCents: 40,
        apiCalls: 3,
        startedAt: '2024-01-10T10:30:00.000Z',
      });

      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 'p1',
        costCents: 140,
        subagentCostCents: 40,
        subagentCalls: 3,
      });
    });

    it('[FR-USAGE-060] should include subagent rows individually when includeSubagents is true', async () => {
      seedSession(ctx, { sessionId: 'p1', isSubagent: false, estCostCents: 100 });
      seedSession(ctx, {
        sessionId: 'c1',
        parentSessionId: 'p1',
        isSubagent: true,
        estCostCents: 40,
        startedAt: '2024-01-10T10:30:00.000Z',
      });

      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10', includeSubagents: true });

      expect(sessions).toHaveLength(2);
      const child = sessions.find((s) => s.sessionId === 'c1')!;
      expect(child.costCents).toBe(40);
      expect(child.isSubagent).toBe(true);
    });

    it('[FR-USAGE-070] should still surface an orphan subagent whose parent row is missing', async () => {
      seedSession(ctx, {
        sessionId: 'orphan',
        parentSessionId: 'does-not-exist',
        isSubagent: true,
        estCostCents: 25,
      });

      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ sessionId: 'orphan', costCents: 25 });
    });

    it('should sort by apiCalls when sort is calls', async () => {
      seedSession(ctx, { sessionId: 'low', estCostCents: 500, apiCalls: 2 });
      seedSession(ctx, { sessionId: 'high', estCostCents: 10, apiCalls: 50 });

      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10', sort: 'calls' });

      expect(sessions.map((s) => s.sessionId)).toEqual(['high', 'low']);
    });

    it('should bucket a session by its local start date, not the UTC date sliced from startedAt', async () => {
      // UTC date is 2024-01-11 (02:00Z) but the daemon recorded a local date
      // of 2024-01-10 — a timezone behind UTC crossing midnight.
      seedSession(ctx, {
        sessionId: 'local-boundary',
        startedAt: '2024-01-11T02:00:00.000Z',
        startedDate: '2024-01-10',
      });

      const localDay = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(localDay.map((s) => s.sessionId)).toEqual(['local-boundary']);

      const utcDay = await caller.usage.sessions({ from: '2024-01-11', to: '2024-01-11' });
      expect(utcDay).toHaveLength(0);
    });
  });

  describe('session', () => {
    it('[FR-USAGE-310] should throw NOT_FOUND for an unknown session id', async () => {
      await expect(caller.usage.session({ sessionId: 'missing' })).rejects.toThrow('missing');
    });

    it('[FR-USAGE-310] should return tool/file/field/call/subagent breakdowns for one session', async () => {
      seedSession(ctx, { sessionId: 's1', cacheReadTokens: 1000, compactions: 3 });
      seedSession(ctx, { sessionId: 'child', parentSessionId: 's1', isSubagent: true, estCostCents: 15 });
      seedTool(ctx, { toolName: 'Read', attributedCostMicroCents: 42_000_000 });
      seedFile(ctx, { attributedCostMicroCents: 10_000_000 });
      seedField(ctx, { tokenTurns: 10, tokens: 5, attributedCostMicroCents: 2_000_000 });
      seedCause(ctx, { kind: 'toolInput', tokenTurns: 10 });
      seedCall(ctx, { callIndex: 0, cacheReadTokens: 500 });
      seedCall(ctx, { callIndex: 1, cacheReadTokens: 500 });

      const detail = await caller.usage.session({ sessionId: 's1' });

      expect(detail.session.sessionId).toBe('s1');
      expect(detail.session.subagentCostCents).toBe(15);
      expect(detail.session.compactions).toBe(3);
      expect(detail.tools).toHaveLength(1);
      expect(detail.files).toHaveLength(1);
      expect(detail.fields).toHaveLength(1);
      expect(detail.fields[0].costCents).toBe(2);
      expect(detail.callSeries).toEqual([
        { callIndex: 0, cacheReadTokens: 500 },
        { callIndex: 1, cacheReadTokens: 500 },
      ]);
      expect(detail.subagents).toHaveLength(1);
      expect(detail.subagents[0]).toMatchObject({ sessionId: 'child', costCents: 15 });
    });

    it('[FR-USAGE-310] should merge the daily rows of a session that spans several days', async () => {
      seedSession(ctx, { sessionId: 's1' });
      for (const date of ['2024-01-10', '2024-01-11']) {
        seedTool(ctx, { date, toolName: 'Bash', calls: 2, attributedCostMicroCents: 1_000_000 });
        seedFile(ctx, { date, reads: 1, attributedCostMicroCents: 1_000_000 });
        seedField(ctx, { date, calls: 1, tokens: 5, attributedCostMicroCents: 1_000_000 });
      }

      const detail = await caller.usage.session({ sessionId: 's1' });

      expect(detail.tools).toEqual([
        expect.objectContaining({ tool: 'Bash', calls: 4, costCents: 2 }),
      ]);
      expect(detail.files).toEqual([
        expect.objectContaining({ key: 'src/index.ts', reads: 2, costCents: 2 }),
      ]);
      expect(detail.fields).toEqual([
        expect.objectContaining({ field: 'prompt', calls: 2, tokens: 10 }),
      ]);
    });
  });

  describe('refresh', () => {
    it('[FR-USAGE-240] should return an empty result when no daemon is connected', async () => {
      const result = await caller.usage.refresh();
      expect(result).toMatchObject({ scannedFiles: 0, newSessions: 0 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('[FR-USAGE-250] [FR-WS-210] should upsert a scanned session from the daemon and broadcast the change', async () => {
      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult()],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));

      const result = await caller.usage.refresh();

      expect(result.newSessions).toBe(1);

      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ sessionId: 'scan-1', label: 'Fix the flaky test' });
    });

    it('[FR-USAGE-210] should accumulate usageSessionDaily across two sessions sharing date/slug/model, not overwrite', async () => {
      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult({ sessionId: 'sess-a' })],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();
      const afterFirst = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult({ sessionId: 'sess-b' })],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();
      const afterSecond = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      // Each session's daily rollup carries apiCalls: 2 — the shared (date, slug, model)
      // row must sum both sessions' contributions, not retain only the second write's.
      expect(afterFirst.totals.apiCalls).toBe(2);
      expect(afterSecond.totals.apiCalls).toBe(4);
      expect(afterSecond.totals.cacheReadTokens).toBe(2 * afterFirst.totals.cacheReadTokens);
    });

    it('[FR-USAGE-210] [FR-WS-220] should add a resumed scan tail to the totals already stored, not replace them', async () => {
      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult()],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();
      const afterFirst = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      installFakeUsageDaemon(ctx, () => ({
        sessions: [{ ...makeScanResult(), isFullParse: false }],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();

      const afterTail = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });
      const session = await caller.usage.session({ sessionId: 'scan-1' });

      expect(afterTail.totals.apiCalls).toBe(2 * afterFirst.totals.apiCalls);
      expect(afterTail.totals.cacheReadTokens).toBe(2 * afterFirst.totals.cacheReadTokens);
      expect(session.session.apiCalls).toBe(4);
      // The tail renumbers its calls from 1, so they continue the stored series.
      expect(session.callSeries.map((point) => point.callIndex)).toEqual([0, 1, 2, 3]);
    });

    it('[FR-USAGE-210] [FR-WS-220] should replace a session rescanned in full rather than double-counting it', async () => {
      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult()],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();
      const afterFirst = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      // A truncated or rewritten transcript is reparsed from byte 0, so the
      // rollups are the whole file again.
      await caller.usage.refresh();
      const afterReparse = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      expect(afterReparse.totals.apiCalls).toBe(afterFirst.totals.apiCalls);
      expect(afterReparse.cost.total).toBe(afterFirst.cost.total);

      const session = await caller.usage.session({ sessionId: 'scan-1' });
      expect(session.tools[0].calls).toBe(3);
      expect(session.files[0].reads).toBe(2);
    });

    it('[FR-USAGE-350] should persist a scanned session\'s expensive calls', async () => {
      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult()],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();

      const calls = await caller.usage.expensiveCalls({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ tool: 'Read', preview: 'src/index.ts', tokenTurns: 400 });
    });

    it('[FR-USAGE-350] should prune a session\'s expensive calls to its top 20 by tokenTurns across many scan passes, not grow unbounded', async () => {
      const sessionId = 'growing-1';
      installFakeUsageDaemon(ctx, () => ({
        sessions: [makeScanResult({ sessionId })],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh(); // full parse — one row at tokenTurns 400.

      // 25 incremental tail passes, each contributing one new expensive-call
      // row (a session refreshed many times must not accumulate one row per
      // pass forever).
      for (let i = 0; i < 25; i += 1) {
        const scan = makeScanResult({ sessionId });
        scan.isFullParse = false;
        scan.scan.expensiveCalls = [
          {
            date: '2024-01-10',
            sessionId,
            tool: 'Write',
            field: 'file_path',
            tokens: 100,
            tokenTurns: 1000 + i,
            callIndex: 0,
            preview: `file-${i}.ts`,
          },
        ];
        installFakeUsageDaemon(ctx, () => ({
          sessions: [scan],
          files: {},
          newlySealedDates: [],
          staleSealSkips: 0,
        }));
        await caller.usage.refresh();
      }

      const calls = await caller.usage.expensiveCalls({ from: '2024-01-10', to: '2024-01-10', limit: 200 });
      const forSession = calls.filter((c) => c.sessionId === sessionId);

      expect(forSession).toHaveLength(20);
      // The lowest-tokenTurns rows (the original 400 and the earliest tail
      // passes) are pruned, keeping only the session's overall top 20.
      expect(Math.min(...forSession.map((c) => c.tokenTurns))).toBe(1005);
    });

    it('[FR-USAGE-380] should forward since to the daemon scan request', async () => {
      const requests = installTrackingUsageDaemon(ctx, () => ({
        sessions: [],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));

      await caller.usage.refresh({ since: '2024-01-01' });

      expect(requests).toEqual([{ since: '2024-01-01' }]);
    });

    it('should reject a since that is not an ISO date', async () => {
      await expect(caller.usage.refresh({ since: 'not-a-date' })).rejects.toThrow();
    });

    it('should serve a second concurrent call from the in-flight scan instead of starting a new one', async () => {
      const requests = installTrackingUsageDaemon(ctx, () => ({
        sessions: [makeScanResult()],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));

      const [first, second] = await Promise.all([caller.usage.refresh(), caller.usage.refresh()]);

      expect(requests).toHaveLength(1);
      expect(first).toEqual(second);
    });

    it('should allow a fresh scan once the in-flight one has settled', async () => {
      const requests = installTrackingUsageDaemon(ctx, () => ({
        sessions: [],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));

      await caller.usage.refresh();
      await caller.usage.refresh();

      expect(requests).toHaveLength(2);
    });

    it('should invalidate a stale-version seal and force a full rescan', async () => {
      seedSession(ctx, { sessionId: 's1' });
      ctx.db
        .insert(usageSealedDate)
        .values({ date: '2024-01-01', reducerVersion: USAGE_REDUCER_VERSION - 1 })
        .run();

      await caller.usage.refresh();

      expect(ctx.db.select().from(usageSealedDate).all()).toHaveLength(0);
      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(sessions).toHaveLength(0);
    });

    it('should leave a current-version seal untouched', async () => {
      seedSession(ctx, { sessionId: 's1' });
      ctx.db.insert(usageSealedDate).values({ date: '2024-01-01', reducerVersion: USAGE_REDUCER_VERSION }).run();

      await caller.usage.refresh();

      expect(ctx.db.select().from(usageSealedDate).all()).toHaveLength(1);
      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(sessions).toHaveLength(1);
    });
  });

  describe('rebuild', () => {
    it('[FR-USAGE-360] should clear every usage table and broadcast the change', async () => {
      seedSession(ctx, { sessionId: 's1' });
      seedDaily(ctx);
      seedTool(ctx);

      const result = await caller.usage.rebuild();

      expect(result).toEqual({ rebuilt: true });
      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(sessions).toHaveLength(0);
      const tools = await caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 10 });
      expect(tools).toHaveLength(0);
    });

    it('should reject rebuild while a scan is running and leave its rows intact', async () => {
      seedSession(ctx, { sessionId: 'existing' });
      seedDaily(ctx, { sessionId: 'existing' });

      let resolveScan: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        resolveScan = resolve;
      });
      const mock = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (raw: string) => {
          const msg = JSON.parse(raw) as DaemonMessage;
          if (msg.type !== 'USAGE_SCAN_REQUEST') return;
          gate.then(() => {
            const pending = ctx.state.pendingUsageScan.get(msg.payload.requestId);
            if (!pending) return;
            ctx.state.pendingUsageScan.delete(msg.payload.requestId);
            pending.resolve({
              requestId: msg.payload.requestId,
              sessions: [makeScanResult()],
              files: {},
              newlySealedDates: [],
              staleSealSkips: 0,
            } as never);
          });
        },
      };
      ctx.state.daemon = mock as unknown as WebSocket;

      // Calling `refreshUsage` directly (not through the tRPC caller) sets the
      // in-flight flag synchronously, so `rebuild` is guaranteed to see it —
      // routing both calls through the caller races on tRPC's own input
      // validation, which varies per procedure.
      const refreshPromise = refreshUsage(ctx.state, undefined);
      await expect(caller.usage.rebuild()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      const midScan = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(midScan.map((s) => s.sessionId)).toContain('existing');

      resolveScan?.();
      await refreshPromise;

      const afterScan = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(afterScan.map((s) => s.sessionId).sort()).toEqual(['existing', 'scan-1']);
    });

    it('[FR-USAGE-360] should leave pricing untouched so the next scan can still price sessions', async () => {
      await caller.usage.rebuild();

      installFakeUsageDaemon(ctx, () => ({
        // makeScanResult()'s default token counts round to 0 cents — scale
        // input up so a wiped pricing table would be visible as 0, not as a
        // coincidental sub-cent rounding to 0.
        sessions: [makeScanResult({ inputTokens: 5_000_000 })],
        files: {},
        newlySealedDates: [],
        staleSealSkips: 0,
      }));
      await caller.usage.refresh();

      const sessions = await caller.usage.sessions({ from: '2024-01-10', to: '2024-01-10' });
      expect(sessions[0].costCents).toBeGreaterThan(0);
    });
  });
});
