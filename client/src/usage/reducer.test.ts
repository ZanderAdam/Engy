import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('line pre-filter', () => {
    it('[FR-USAGE-020] should keep lines carrying usage', () => {
      expect(lineMayMatter('{"cache_read_input_tokens":5}')).toBe(true);
    });

    it('[FR-USAGE-020] should keep lines carrying content blocks', () => {
      expect(lineMayMatter('{"type":"tool_result"}')).toBe(true);
    });

    it('[FR-USAGE-020] should drop lines carrying neither', () => {
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

    it('[FR-USAGE-170] should bucket usage by date and model', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T10:00:00.000Z', cacheRead: 100 }),
        usageLine({ timestamp: '2026-09-02T10:00:00.000Z', cacheRead: 200 }),
      ]);
      expect(scan.days).toHaveLength(2);
      expect(scan.days.map((d) => d.date).sort()).toEqual(['2026-09-01', '2026-09-02']);
    });

    it('[FR-USAGE-030] should skip malformed lines without aborting the scan', () => {
      const scan = reduce(['{"cache_read_input_tokens": broken', usageLine({ cacheRead: 42 })]);
      expect(scan.session.cacheReadTokens).toBe(42);
      expect(scan.linesSkipped).toBe(1);
    });
  });

  describe('residual attribution', () => {
    it('[FR-USAGE-090] should charge a block once per API call that follows it', () => {
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

    it('[FR-USAGE-090] should include a tool call input in that tool total, not only its result', () => {
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

    it('[FR-USAGE-090] should charge nothing to content added after the final call', () => {
      const scan = reduce([usageLine({}), toolUseLine('t1', 'Read', {}), toolResultLine('t1', 'x'.repeat(3600))]);
      const read = scan.tools.find((t) => t.tool === 'Read');
      expect(read?.tokenTurns).toBe(0);
    });

    it('[FR-USAGE-090] should make an early block cost more than an identical late one', () => {
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

    it('[FR-USAGE-100] should stop charging a block once the context collapses', () => {
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

    it('[FR-USAGE-100] should charge a block added after a compaction against the later calls', () => {
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

    it('[FR-USAGE-100] should report how many times the session compacted', () => {
      const scan = reduce([
        big(200_000),
        big(20_000),
        big(200_000),
        big(20_000),
        big(20_000),
      ]);
      expect(scan.compactions).toBe(2);
    });

    it('[FR-USAGE-100] should ignore a context drop below the small-context floor', () => {
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
    it('[FR-USAGE-110] should separate tool inputs from tool results', () => {
      const scan = reduce([
        toolUseLine('t1', 'Agent', { prompt: 'p'.repeat(3600) }),
        toolResultLine('t1', 'r'.repeat(360)),
        usageLine({}),
      ]);
      expect(causeTokens(scan, 'toolInput')).toBeGreaterThan(causeTokens(scan, 'toolResult'));
    });

    it('[FR-USAGE-290] should attribute input cost down to the individual field', () => {
      const scan = reduce([
        toolUseLine('t1', 'Agent', { prompt: 'p'.repeat(36000), description: 'short' }),
        usageLine({}),
      ]);
      const prompt = scan.fields.find((f) => f.tool === 'Agent' && f.field === 'prompt');
      const description = scan.fields.find((f) => f.tool === 'Agent' && f.field === 'description');
      expect(prompt?.tokenTurns).toBeGreaterThan(9000);
      expect(description?.tokenTurns).toBeLessThan(100);
    });

    it('should count how many tool calls contributed to a field row', () => {
      const scan = reduce([
        toolUseLine('t1', 'Agent', { prompt: 'a' }),
        toolUseLine('t2', 'Agent', { prompt: 'b' }),
        toolUseLine('t3', 'Agent', { prompt: 'c', description: 'x' }),
        usageLine({}),
      ]);
      const prompt = scan.fields.find((f) => f.tool === 'Agent' && f.field === 'prompt');
      const description = scan.fields.find((f) => f.tool === 'Agent' && f.field === 'description');
      expect(prompt?.calls).toBe(3);
      expect(description?.calls).toBe(1);
    });

    it('[FR-USAGE-080] should count an image result as an image cause, not a tool result', () => {
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

    it('should accumulate the real character count per file, not just the token estimate', () => {
      const scan = reduce([
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }),
        toolResultLine('t1', 'x'.repeat(360)),
        toolUseLine('t2', 'Read', { file_path: '/a.ts' }),
        toolResultLine('t2', 'x'.repeat(140)),
        usageLine({}),
      ]);
      expect(scan.files.find((f) => f.filePath === '/a.ts')?.totalChars).toBe(500);
    });
  });

  describe('tool result-size distribution', () => {
    it('[FR-USAGE-400] should compute exact p50/p95 for a known distribution', () => {
      const sizes = [100, 200, 300, 400, 500];
      const lines = sizes.flatMap((size, i) => [
        toolUseLine(`t${i}`, 'Read', {}),
        toolResultLine(`t${i}`, 'x'.repeat(size)),
      ]);
      const scan = reduce([...lines, usageLine({})]);
      const read = scan.tools.find((t) => t.tool === 'Read');
      expect(read?.p50ResultChars).toBe(300);
      expect(read?.p95ResultChars).toBe(500);
    });

    it('[FR-USAGE-400] should stay bounded and correct when fed far more samples than the reservoir cap', () => {
      const lines: string[] = [];
      for (let i = 0; i < 5000; i += 1) {
        lines.push(toolUseLine(`t${i}`, 'Read', {}));
        lines.push(toolResultLine(`t${i}`, 'x'.repeat(777)));
      }
      lines.push(usageLine({}));
      const scan = reduce(lines);
      const read = scan.tools.find((t) => t.tool === 'Read');
      expect(read?.p50ResultChars).toBe(777);
      expect(read?.p95ResultChars).toBe(777);
    });
  });

  describe('expensive calls', () => {
    it('[FR-USAGE-350] should keep only the top 20 calls by payload size, dropping the rest', () => {
      const lines: string[] = [usageLine({})];
      for (let i = 1; i <= 25; i += 1) {
        lines.push(toolUseLine(`t${i}`, 'Read', { file_path: `/f${i}.ts` }));
        lines.push(toolResultLine(`t${i}`, 'x'.repeat(i * 400)));
      }
      lines.push(usageLine({}));

      const scan = reduce(lines);

      expect(scan.expensiveCalls).toHaveLength(20);
      const previews = scan.expensiveCalls.map((c) => c.preview);
      for (let i = 1; i <= 5; i += 1) expect(previews).not.toContain(`/f${i}.ts`);
      for (let i = 6; i <= 25; i += 1) expect(previews).toContain(`/f${i}.ts`);
    });

    it('[FR-USAGE-350] should sort the surviving calls by settled token-turns descending', () => {
      const scan = reduce([
        toolUseLine('t1', 'Read', { file_path: '/small.ts' }),
        toolResultLine('t1', 'x'.repeat(100)),
        toolUseLine('t2', 'Read', { file_path: '/big.ts' }),
        toolResultLine('t2', 'x'.repeat(10_000)),
        usageLine({}),
        usageLine({}),
      ]);
      expect(scan.expensiveCalls[0].preview).toBe('/big.ts');
    });

    it('[FR-USAGE-350] a call before a compaction must not outrank an equal one after it that is re-read more', () => {
      const payload = 'x'.repeat(3600);
      const big = (cacheRead: number) => usageLine({ cacheRead });

      const scan = reduce([
        big(200_000),
        toolUseLine('a', 'Write', { content: payload }),
        toolResultLine('a', 'ok'),
        big(200_000),
        big(20_000), // context collapses here — settles every open candidate, including "a"
        toolUseLine('b', 'Write', { content: payload }),
        toolResultLine('b', 'ok'),
        big(20_000),
        big(20_000),
        big(20_000),
      ]);

      const a = scan.expensiveCalls.find((c) => c.callIndex === 1);
      const b = scan.expensiveCalls.find((c) => c.callIndex === 2);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      // Equal payloads, but "a" settled at the compaction while "b" kept
      // accumulating afterwards, so "b" must rank above "a".
      expect(a?.tokens).toBe(b?.tokens);
      expect(b!.tokenTurns).toBeGreaterThan(a!.tokenTurns);
      expect(scan.expensiveCalls[0].callIndex).toBe(2);
    });

    it('should give two parallel tool results carried by one message distinct callIndex values', () => {
      const scan = reduce([
        usageLine({}),
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }),
        toolUseLine('t2', 'Read', { file_path: '/b.ts' }),
        // Both results arrive in the same user message — callsSoFar does not
        // advance between them, so a callIndex keyed off it alone would collide.
        JSON.stringify({
          type: 'user',
          timestamp: '2026-09-01T10:00:00.000Z',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(360) },
              { type: 'tool_result', tool_use_id: 't2', content: 'y'.repeat(360) },
            ],
          },
        }),
        usageLine({}),
      ]);

      const reads = scan.expensiveCalls.filter((c) => c.tool === 'Read');
      expect(reads).toHaveLength(2);
      expect(new Set(reads.map((c) => c.callIndex)).size).toBe(2);
    });

    it('should not give an unmatched result a top-20 slot', () => {
      const scan = reduce([toolResultLine('no-such-id', 'x'.repeat(360)), usageLine({})]);

      expect(scan.expensiveCalls).toHaveLength(0);
    });
  });

  describe('call preview truncation', () => {
    it('should keep a long path\'s basename and mark the cut with an ellipsis', () => {
      const longDir =
        '/home/aleks/.claude/projects/-home-aleks-dev-Engy--claude-worktrees-aadamovic-m14-agent-hook-channel';
      const fileName = 'c72d7d36-29fd-4900-abcd-1234567890ab.jsonl';
      const scan = reduce([
        toolUseLine('t1', 'Read', { file_path: `${longDir}/${fileName}` }),
        toolResultLine('t1', 'ok'),
        usageLine({}),
      ]);

      const preview = scan.expensiveCalls.find((c) => c.tool === 'Read')?.preview;
      expect(preview?.startsWith('…')).toBe(true);
      expect(preview?.endsWith(fileName)).toBe(true);
    });

    it('should keep a long command\'s start and mark the cut with an ellipsis', () => {
      const command = `echo start-marker ${'x'.repeat(200)}`;
      const scan = reduce([
        toolUseLine('t1', 'Bash', { command }),
        toolResultLine('t1', 'ok'),
        usageLine({}),
      ]);

      const preview = scan.expensiveCalls.find((c) => c.tool === 'Bash')?.preview;
      expect(preview?.startsWith('echo start-marker')).toBe(true);
      expect(preview?.endsWith('…')).toBe(true);
    });
  });

  describe('pending tool_use bound', () => {
    it('[FR-USAGE-390] should evict the oldest unmatched tool_use once the pending map exceeds its cap, instead of growing without bound', () => {
      const lines: string[] = [];
      for (let i = 0; i <= 1000; i += 1) {
        lines.push(toolUseLine(`t${i}`, 'Read', { file_path: `/f${i}.ts` }));
      }
      lines.push(toolResultLine('t0', 'x'.repeat(360)));
      lines.push(toolResultLine('t1000', 'x'.repeat(360)));
      lines.push(usageLine({}));

      const scan = reduce(lines);

      expect(scan.files.find((f) => f.filePath === '/f0.ts')).toBeUndefined();
      expect(scan.tools.find((t) => t.tool === 'unknown')?.calls).toBe(1);
      expect(scan.files.find((f) => f.filePath === '/f1000.ts')).toBeDefined();
    });

    it('[FR-USAGE-390] should still attribute a tool_result to the right tool and file when the pending map is below its cap', () => {
      const lines: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        lines.push(toolUseLine(`unmatched${i}`, 'Bash', { command: `echo ${i}` }));
      }
      lines.push(toolUseLine('t-normal', 'Read', { file_path: '/a.ts' }));
      lines.push(toolResultLine('t-normal', 'x'.repeat(360)));
      lines.push(usageLine({}));

      const scan = reduce(lines);

      const file = scan.files.find((f) => f.filePath === '/a.ts');
      expect(file).toMatchObject({ filePath: '/a.ts', reads: 1 });
      expect(scan.tools.find((t) => t.tool === 'Read')?.calls).toBe(1);
    });

    it('[FR-USAGE-390] should still resolve a tool_use opened before a compaction when its result arrives after it', () => {
      const payload = 'x'.repeat(360);
      const big = (cacheRead: number) => usageLine({ cacheRead });

      const scan = reduce([
        big(200_000),
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }),
        big(20_000), // context collapses here; the pending entry for "t1" is kept, not cleared
        toolResultLine('t1', payload),
        big(20_000),
      ]);

      expect(scan.compactions).toBe(1);
      expect(scan.files.find((f) => f.filePath === '/a.ts')).toMatchObject({ reads: 1 });
      expect(scan.tools.find((t) => t.tool === 'unknown')).toBeUndefined();
    });
  });

  describe('context-growth series', () => {
    it('[FR-USAGE-230] should record one point per API call for a short session', () => {
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

    it('[FR-USAGE-230] should downsample a long session instead of growing without bound', () => {
      const scan = reduce(Array.from({ length: 5000 }, (_, i) => usageLine({ cacheRead: i })));
      expect(scan.session.apiCalls).toBe(5000);
      expect(scan.calls.length).toBeLessThanOrEqual(200);
      expect(scan.calls.length).toBeGreaterThan(50);
    });

    it('[FR-USAGE-230] should keep the series ordered and spanning the whole session', () => {
      const scan = reduce(Array.from({ length: 5000 }, (_, i) => usageLine({ cacheRead: i * 10 })));
      const indexes = scan.calls.map((p) => p.callIndex);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
      expect(indexes[0]).toBe(1);
      expect(indexes[indexes.length - 1]).toBeGreaterThan(4000);
    });
  });

  describe('subagent identity', () => {
    it('[FR-USAGE-050] should mark a transcript with a parent as a subagent', () => {
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

    it('[FR-USAGE-050] should mark a transcript with no parent as a main session', () => {
      const scan = reduce([usageLine({})]);
      expect(scan.session).toMatchObject({ isSubagent: false, parentSessionId: null });
    });
  });

  describe('date bucketing', () => {
    it('[FR-USAGE-170] should split a tool across the dates its calls fall on', () => {
      // Dates bucket by local time, so pin UTC to keep this boundary-crossing
      // assertion independent of the host's TZ.
      vi.stubEnv('TZ', 'UTC');
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

    it('[FR-USAGE-170] should bucket a file rollup by the date it was touched', () => {
      const scan = reduce([
        usageLine({ timestamp: '2026-09-01T23:50:00.000Z' }),
        toolUseLine('t1', 'Read', { file_path: '/a.ts' }, '2026-09-01T23:51:00.000Z'),
        toolResultLine('t1', 'x'.repeat(360), '2026-09-01T23:52:00.000Z'),
        usageLine({ timestamp: '2026-09-02T00:10:00.000Z' }),
      ]);
      expect(scan.files.find((f) => f.filePath === '/a.ts')?.date).toBe('2026-09-01');
    });

    it('[FR-USAGE-170] should bucket causes by date', () => {
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

    it('should emit startedDate as the local calendar day, not the UTC day, when they differ', () => {
      vi.stubEnv('TZ', 'Europe/Berlin');
      // 2024-01-10T23:30Z is 2024-01-11T00:30 in Berlin (UTC+1 in January).
      const scan = reduce([usageLine({ timestamp: '2024-01-10T23:30:00.000Z' })]);
      expect(scan.session.startedAt).toBe('2024-01-10T23:30:00.000Z');
      expect(scan.session.startedDate).toBe('2024-01-11');
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
