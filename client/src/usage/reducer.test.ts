import { describe, it, expect } from 'vitest';
import { SessionReducer, lineMayMatter } from './reducer.js';

function usageLine(options: {
  model?: string;
  timestamp?: string;
  cacheRead?: number;
  cacheWrite1h?: number;
  output?: number;
  thinking?: number;
  content?: unknown[];
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: options.timestamp ?? '2026-09-01T10:00:00.000Z',
    cwd: '/repo',
    gitBranch: 'main',
    message: {
      model: options.model ?? 'claude-opus-5',
      content: options.content ?? [],
      usage: {
        input_tokens: 1,
        output_tokens: options.output ?? 10,
        output_tokens_details: { thinking_tokens: options.thinking ?? 0 },
        cache_read_input_tokens: options.cacheRead ?? 1000,
        cache_creation_input_tokens: options.cacheWrite1h ?? 0,
        cache_creation: {
          ephemeral_1h_input_tokens: options.cacheWrite1h ?? 0,
          ephemeral_5m_input_tokens: 0,
        },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
    },
  });
}

function toolUseLine(
  id: string,
  name: string,
  input: Record<string, unknown>,
  timestamp = '2026-09-01T10:00:00.000Z',
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { model: 'claude-opus-5', content: [{ type: 'tool_use', id, name, input }] },
  });
}

function toolResultLine(
  id: string,
  content: unknown,
  timestamp = '2026-09-01T10:00:00.000Z',
): string {
  return JSON.stringify({
    type: 'user',
    timestamp,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });
}

function causeTokens(scan: { causes: Array<{ kind: string; tokenTurns: number }> }, kind: string) {
  return scan.causes
    .filter((c) => c.kind === kind)
    .reduce((total, c) => total + c.tokenTurns, 0);
}

function reduce(lines: string[]) {
  const reducer = new SessionReducer({ sessionId: 'sess-1', slug: '-repo' });
  for (const line of lines) reducer.addLine(line);
  return reducer.finish();
}

describe('usage reducer', () => {
  describe('line pre-filter', () => {
    it('should keep lines carrying usage', () => {
      expect(lineMayMatter('{"cache_read_input_tokens":5}')).toBe(true);
    });

    it('should keep lines carrying content blocks', () => {
      expect(lineMayMatter('{"type":"tool_result"}')).toBe(true);
    });

    it('should drop lines carrying neither', () => {
      expect(lineMayMatter('{"type":"summary","leafUuid":"abc"}')).toBe(false);
    });
  });

  describe('token totals', () => {
    it('should sum every usage bucket across calls', () => {
      const scan = reduce([
        usageLine({ cacheRead: 1000, cacheWrite1h: 500, output: 20, thinking: 5 }),
        usageLine({ cacheRead: 2000, cacheWrite1h: 100, output: 30, thinking: 7 }),
      ]);
      expect(scan.session.apiCalls).toBe(2);
      expect(scan.session.cacheReadTokens).toBe(3000);
      expect(scan.session.cacheWrite1hTokens).toBe(600);
      expect(scan.session.outputTokens).toBe(50);
      expect(scan.session.thinkingTokens).toBe(12);
    });

    it('should record the dominant model for the session', () => {
      const scan = reduce([
        usageLine({ model: 'claude-opus-5' }),
        usageLine({ model: 'claude-opus-5' }),
        usageLine({ model: 'claude-fable-5-1' }),
      ]);
      expect(scan.session.model).toBe('claude-opus-5');
    });

    it('should bucket usage by date and model', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T10:00:00.000Z', cacheRead: 100 }),
        usageLine({ timestamp: '2026-09-02T10:00:00.000Z', cacheRead: 200 }),
      ]);
      expect(scan.days).toHaveLength(2);
      expect(scan.days.map((d) => d.date).sort()).toEqual(['2026-09-01', '2026-09-02']);
    });

    it('should skip malformed lines without aborting the scan', () => {
      const scan = reduce(['{"cache_read_input_tokens": broken', usageLine({ cacheRead: 42 })]);
      expect(scan.session.cacheReadTokens).toBe(42);
      expect(scan.linesSkipped).toBe(1);
    });
  });

  describe('residual attribution', () => {
    it('should charge a block once per API call that follows it', () => {
      // Tool result lands before 3 further calls, so 360 chars (100 tokens)
      // are re-read 3 times.
      const scan = reduce([
        usageLine({}),
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }),
        toolResultLine('t1', 'x'.repeat(360)),
        usageLine({}),
        usageLine({}),
        usageLine({}),
      ]);
      expect(causeTokens(scan, 'toolResult')).toBeCloseTo(300, 0);
    });

    it('should include a tool call input in that tool total, not only its result', () => {
      const lines = (input: Record<string, unknown>) => [
        usageLine({}),
        toolUseLine('t1', 'Read', input),
        toolResultLine('t1', 'x'.repeat(360)),
        usageLine({}),
      ];
      const bare = reduce(lines({})).tools.find((t) => t.tool === 'Read')?.tokenTurns ?? 0;
      const withPath = reduce(lines({ file_path: '/some/long/path.ts' })).tools.find(
        (t) => t.tool === 'Read',
      )?.tokenTurns;
      expect(withPath).toBeGreaterThan(bare);
    });

    it('should charge nothing to content added after the final call', () => {
      const scan = reduce([usageLine({}), toolUseLine('t1', 'Read', {}), toolResultLine('t1', 'x'.repeat(3600))]);
      const read = scan.tools.find((t) => t.tool === 'Read');
      expect(read?.tokenTurns).toBe(0);
    });

    it('should make an early block cost more than an identical late one', () => {
      const payload = 'x'.repeat(3600);
      const early = reduce([
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', payload),
        usageLine({}),
        usageLine({}),
        usageLine({}),
        usageLine({}),
      ]);
      const late = reduce([
        usageLine({}),
        usageLine({}),
        usageLine({}),
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', payload),
        usageLine({}),
      ]);
      const earlyCost = early.tools.find((t) => t.tool === 'Read')?.tokenTurns ?? 0;
      const lateCost = late.tools.find((t) => t.tool === 'Read')?.tokenTurns ?? 0;
      expect(earlyCost).toBeGreaterThan(lateCost * 3);
    });
  });

  describe('compaction', () => {
    const big = (cacheRead: number) => usageLine({ cacheRead });

    it('should stop charging a block once the context collapses', () => {
      const payload = 'x'.repeat(3600);
      const withCompaction = reduce([
        big(200_000),
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', payload),
        big(200_000),
        big(20_000),
        big(20_000),
        big(20_000),
        big(20_000),
        big(20_000),
      ]);
      const withoutCompaction = reduce([
        big(200_000),
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', payload),
        big(200_000),
        big(200_000),
        big(200_000),
        big(200_000),
        big(200_000),
        big(200_000),
      ]);
      expect(causeTokens(withCompaction, 'toolResult')).toBeLessThan(
        causeTokens(withoutCompaction, 'toolResult') * 0.5,
      );
    });

    it('should charge a block added after a compaction against the later calls', () => {
      const payload = 'x'.repeat(3600);
      const scan = reduce([
        big(200_000),
        big(20_000),
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', payload),
        big(20_000),
        big(20_000),
        big(20_000),
      ]);
      expect(causeTokens(scan, 'toolResult')).toBeCloseTo(3000, -2);
    });

    it('should report how many times the session compacted', () => {
      const scan = reduce([
        big(200_000),
        big(20_000),
        big(200_000),
        big(20_000),
        big(20_000),
      ]);
      expect(scan.compactions).toBe(2);
    });

    it('should ignore a context drop below the small-context floor', () => {
      const payload = 'x'.repeat(3600);
      const scan = reduce([
        big(5_000),
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', payload),
        big(500),
        big(500),
        big(500),
      ]);
      expect(causeTokens(scan, 'toolResult')).toBeCloseTo(3000, -2);
    });
  });

  describe('cause and field breakdown', () => {
    it('should separate tool inputs from tool results', () => {
      const scan = reduce([
        toolUseLine('t1', 'Agent', { prompt: 'p'.repeat(3600) }),
        toolResultLine('t1', 'r'.repeat(360)),
        usageLine({}),
      ]);
      expect(causeTokens(scan, 'toolInput')).toBeGreaterThan(causeTokens(scan, 'toolResult'));
    });

    it('should attribute input cost down to the individual field', () => {
      const scan = reduce([
        toolUseLine('t1', 'Agent', { prompt: 'p'.repeat(36000), description: 'short' }),
        usageLine({}),
      ]);
      const prompt = scan.fields.find((f) => f.tool === 'Agent' && f.field === 'prompt');
      const description = scan.fields.find((f) => f.tool === 'Agent' && f.field === 'description');
      expect(prompt?.tokenTurns).toBeGreaterThan(9000);
      expect(description?.tokenTurns).toBeLessThan(100);
    });

    it('should count an image result as an image cause, not a tool result', () => {
      const head = Buffer.alloc(32);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
      head.writeUInt32BE(1920, 16);
      head.writeUInt32BE(1080, 20);
      const data = head.toString('base64') + 'A'.repeat(500_000);

      const scan = reduce([
        toolUseLine('t1', 'Read', { file_path: '/shot.png' }),
        toolResultLine('t1', [{ type: 'image', source: { type: 'base64', data } }]),
        usageLine({}),
      ]);
      expect(causeTokens(scan, 'image')).toBeGreaterThan(0);
      expect(causeTokens(scan, 'toolResult')).toBe(0);
      // Priced by pixels: a char-based estimate would be over 100k tokens.
      expect(causeTokens(scan, 'image')).toBeLessThan(2000);
      expect(scan.tools.find((t) => t.tool === 'Read')?.images).toBe(1);
    });
  });

  describe('file rollup', () => {
    it('should count repeated reads of the same path', () => {
      const scan = reduce([
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }),
        toolResultLine('t1', 'x'.repeat(360)),
        toolUseLine('t2', 'Read', { file_path: '/a.ts' }),
        toolResultLine('t2', 'x'.repeat(360)),
        usageLine({}),
      ]);
      const file = scan.files.find((f) => f.filePath === '/a.ts');
      expect(file?.reads).toBe(2);
      expect(file?.ext).toBe('.ts');
    });

    it('should classify writes and edits separately from reads', () => {
      const scan = reduce([
        toolUseLine('t1', 'Write', { file_path: '/a.ts' }),
        toolResultLine('t1', 'ok'),
        toolUseLine('t2', 'Edit', { file_path: '/a.ts' }),
        toolResultLine('t2', 'ok'),
        usageLine({}),
      ]);
      const file = scan.files.find((f) => f.filePath === '/a.ts');
      expect(file).toMatchObject({ writes: 1, edits: 1, reads: 0 });
    });

    it('should tag a path with no extension', () => {
      const scan = reduce([
        toolUseLine('t1', 'Read', { file_path: '/Makefile' }),
        toolResultLine('t1', 'x'),
        usageLine({}),
      ]);
      expect(scan.files.find((f) => f.filePath === '/Makefile')?.ext).toBe('<none>');
    });
  });

  describe('context-growth series', () => {
    it('should record one point per API call for a short session', () => {
      const scan = reduce([
        usageLine({ cacheRead: 100 }),
        usageLine({ cacheRead: 200 }),
        usageLine({ cacheRead: 300 }),
      ]);
      expect(scan.calls).toEqual([
        { callIndex: 1, cacheReadTokens: 100 },
        { callIndex: 2, cacheReadTokens: 200 },
        { callIndex: 3, cacheReadTokens: 300 },
      ]);
    });

    it('should downsample a long session instead of growing without bound', () => {
      const scan = reduce(Array.from({ length: 5000 }, (_, i) => usageLine({ cacheRead: i })));
      expect(scan.session.apiCalls).toBe(5000);
      expect(scan.calls.length).toBeLessThanOrEqual(200);
      expect(scan.calls.length).toBeGreaterThan(50);
    });

    it('should keep the series ordered and spanning the whole session', () => {
      const scan = reduce(Array.from({ length: 5000 }, (_, i) => usageLine({ cacheRead: i * 10 })));
      const indexes = scan.calls.map((p) => p.callIndex);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
      expect(indexes[0]).toBe(1);
      expect(indexes[indexes.length - 1]).toBeGreaterThan(4000);
    });
  });

  describe('subagent identity', () => {
    it('should mark a transcript with a parent as a subagent', () => {
      const reducer = new SessionReducer({
        sessionId: 'agent-abc',
        slug: '-repo',
        parentSessionId: 'sess-1',
        agentType: 'general-purpose',
        agentDescription: 'review the diff',
      });
      reducer.addLine(usageLine({}));
      expect(reducer.finish().session).toMatchObject({
        isSubagent: true,
        parentSessionId: 'sess-1',
        agentType: 'general-purpose',
        agentDescription: 'review the diff',
      });
    });

    it('should mark a transcript with no parent as a main session', () => {
      const scan = reduce([usageLine({})]);
      expect(scan.session).toMatchObject({ isSubagent: false, parentSessionId: null });
    });
  });

  describe('date bucketing', () => {
    it('should split a tool across the dates its calls fall on', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T23:50:00.000Z' }),
        toolUseLine('t1', 'Read', {}),
        toolResultLine('t1', 'x'.repeat(360)),
        usageLine({ timestamp: '2026-09-02T00:10:00.000Z' }),
        toolUseLine('t2', 'Read', {}, '2026-09-02T00:11:00.000Z'),
        toolResultLine('t2', 'x'.repeat(360), '2026-09-02T00:12:00.000Z'),
        usageLine({ timestamp: '2026-09-02T00:20:00.000Z' }),
      ]);
      const dates = scan.tools.filter((t) => t.tool === 'Read').map((t) => t.date).sort();
      expect(dates).toEqual(['2026-09-01', '2026-09-02']);
    });

    it('should bucket a file rollup by the date it was touched', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T23:50:00.000Z' }),
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }, '2026-09-01T23:51:00.000Z'),
        toolResultLine('t1', 'x'.repeat(360), '2026-09-01T23:52:00.000Z'),
        usageLine({ timestamp: '2026-09-02T00:10:00.000Z' }),
      ]);
      expect(scan.files.find((f) => f.filePath === '/a.ts')?.date).toBe('2026-09-01');
    });

    it('should bucket causes by date', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T23:50:00.000Z' }),
        toolUseLine('t1', 'Read', {}, '2026-09-01T23:51:00.000Z'),
        toolResultLine('t1', 'x'.repeat(360), '2026-09-01T23:52:00.000Z'),
        usageLine({ timestamp: '2026-09-02T00:10:00.000Z' }),
      ]);
      const dates = scan.causes.map((c) => c.date);
      expect(dates).toContain('2026-09-01');
    });
  });

  describe('session metadata', () => {
    it('should capture cwd, branch and the timestamp range', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T08:00:00.000Z' }),
        usageLine({ timestamp: '2026-09-01T09:30:00.000Z' }),
      ]);
      expect(scan.session).toMatchObject({
        cwd: '/repo',
        gitBranch: 'main',
        startedAt: '2026-09-01T08:00:00.000Z',
        endedAt: '2026-09-01T09:30:00.000Z',
      });
    });

    it('should count Agent calls for orchestration overhead', () => {
      const scan = reduce([
        toolUseLine('t1', 'Agent', { prompt: 'go' }),
        toolUseLine('t2', 'Agent', { prompt: 'go' }),
        usageLine({}),
      ]);
      expect(scan.session.agentCalls).toBe(2);
    });
  });
});
