import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { UsageSessionScanResult } from '@engy/common';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { usageSession, usageDaily, usageTool, usageField, usageFile, usageCause, usageCall } from '../../db/schema';
import { seedUsagePricing } from '../../usage/pricing';

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

function seedDaily(ctx: TestContext, overrides: Partial<typeof usageDaily.$inferInsert> = {}) {
  ctx.db
    .insert(usageDaily)
    .values({
      date: '2024-01-10',
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
      compactions: 2,
      bytesScanned: 1000,
      linesParsed: 10,
      linesSkipped: 5,
    },
    repoRoot: '/repo',
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
    it('should split a session crossing midnight across its two dates', async () => {
      seedDaily(ctx, { date: '2024-01-10', inputTokens: 1000 });
      seedDaily(ctx, { date: '2024-01-11', inputTokens: 2000 });

      const onlyFirstDay = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });
      expect(onlyFirstDay.totals.inputTokens).toBe(1000);

      const bothDays = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-11' });
      expect(bothDays.totals.inputTokens).toBe(3000);
    });

    it('should compare against the immediately preceding window of equal length', async () => {
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

    it('should mark an unrecognised model as unpriced while still counting its tokens', async () => {
      seedDaily(ctx, { date: '2024-01-10', model: 'claude-unknown-9', inputTokens: 500, cacheReadTokens: 200 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      expect(overview.totals.inputTokens).toBe(500);
      expect(overview.unpricedModels).toContain('claude-unknown-9');
      expect(overview.cost.total).toBe(0);
    });

    it('should cost each cause directly (not scaled) and fold the shortfall into baseline', async () => {
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

    it('should never let baseline go negative when attribution exceeds a short session\'s measured cost', async () => {
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

    it('should never return a fractional cent anywhere in the response', async () => {
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

    it('should include subagent spend in cost.total and report it as its own share', async () => {
      seedDaily(ctx, { date: '2024-01-10', isSubagent: false, inputTokens: 1_000_000 });
      seedDaily(ctx, { date: '2024-01-10', isSubagent: true, inputTokens: 3_000_000 });

      const overview = await caller.usage.overview({ from: '2024-01-10', to: '2024-01-10' });

      // sonnet input rate $2/MTok: main = 1M tokens = $2.00 = 200¢; sub = 3M tokens = $6.00 = 600¢.
      expect(overview.cost.total).toBe(800);
      expect(overview.cost.subagentCost).toBe(600);
      expect(overview.subagentShare).toBeCloseTo(600 / 800);
    });
  });

  describe('tools', () => {
    it('should sort tools by their directly attributed cost descending', async () => {
      seedTool(ctx, { toolName: 'Read', attributedCostCents: 16, calls: 4 });
      seedTool(ctx, { toolName: 'Bash', attributedCostCents: 4, calls: 10 });

      const tools = await caller.usage.tools({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(tools.map((t) => t.tool)).toEqual(['Read', 'Bash']);
      expect(tools[0].costCents).toBe(16);
      expect(tools[0].costPerCallCents).toBe(4);
    });

    it('should bucket each tool call under its own date for a session spanning midnight', async () => {
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
          tokens: 80,
          tokenTurns: 160,
          calls: 2,
        },
      ];
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
  });

  describe('fields', () => {
    it('should aggregate cost by tool.field', async () => {
      seedField(ctx, { tool: 'Agent', field: 'prompt', attributedCostCents: 14, tokens: 300 });
      seedField(ctx, { tool: 'Bash', field: 'command', attributedCostCents: 6, tokens: 100 });

      const fields = await caller.usage.fields({ from: '2024-01-10', to: '2024-01-10', limit: 10 });

      expect(fields[0]).toMatchObject({ tool: 'Agent', field: 'prompt', costCents: 14 });
      expect(fields[1]).toMatchObject({ tool: 'Bash', field: 'command', costCents: 6 });
    });
  });

  describe('files', () => {
    it('should group by extension when groupBy is ext', async () => {
      seedFile(ctx, { filePath: 'a.ts', ext: '.ts', attributedCostCents: 8, tokensEst: 100 });
      seedFile(ctx, { filePath: 'b.ts', ext: '.ts', attributedCostCents: 4, tokensEst: 50 });
      seedFile(ctx, { filePath: 'c.md', ext: '.md', attributedCostCents: 5, tokensEst: 80 });

      const files = await caller.usage.files({ from: '2024-01-10', to: '2024-01-10', limit: 10, groupBy: 'ext' });

      const ts = files.find((f) => f.key === '.ts')!;
      expect(ts.tokens).toBe(150);
      expect(ts.costCents).toBe(12);
    });
  });

  describe('sessions', () => {
    it('should roll a subagent child cost into its parent row', async () => {
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

    it('should include subagent rows individually when includeSubagents is true', async () => {
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

    it('should still surface an orphan subagent whose parent row is missing', async () => {
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
  });

  describe('session', () => {
    it('should throw NOT_FOUND for an unknown session id', async () => {
      await expect(caller.usage.session({ sessionId: 'missing' })).rejects.toThrow('missing');
    });

    it('should return tool/file/field/call/subagent breakdowns for one session', async () => {
      seedSession(ctx, { sessionId: 's1', cacheReadTokens: 1000, compactions: 3 });
      seedSession(ctx, { sessionId: 'child', parentSessionId: 's1', isSubagent: true, estCostCents: 15 });
      seedTool(ctx, { toolName: 'Read', attributedCostCents: 42 });
      seedFile(ctx, { attributedCostCents: 10 });
      seedField(ctx, { tokenTurns: 10, tokens: 5, attributedCostCents: 2 });
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
  });

  describe('refresh', () => {
    it('should return an empty result when no daemon is connected', async () => {
      const result = await caller.usage.refresh();
      expect(result).toMatchObject({ scannedFiles: 0, newSessions: 0 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should upsert a scanned session from the daemon and broadcast the change', async () => {
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
  });
});
