import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, appendFile, stat, utimes } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { scanUsage } from './scan.js';

// Without a collection first, heapUsed also counts lines already read and
// dropped, so it grows with the file even when nothing is kept.
function forceGc(): void {
  setFlagsFromString('--expose-gc');
  (runInNewContext('gc') as () => void)();
}

// One transcript on this machine is 54 MB and a prior OOM (task #229) is why
// the scan must stream. Recording every whole-file read lets a test prove no
// transcript is ever loaded entire.
const wholeFileReads: string[] = [];
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (target: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      wholeFileReads.push(String(target));
      return (actual.readFile as (...args: unknown[]) => unknown)(target, ...rest);
    },
  };
});

describe('scanUsage', () => {
  let homeDir: string;

  async function makeHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'engy-usage-scan-test-'));
    return dir;
  }

  afterEach(async () => {
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function usageLine(opts: {
    timestamp: string;
    cwd?: string;
    gitBranch?: string;
    cacheRead?: number;
  }): string {
    return JSON.stringify({
      type: 'assistant',
      timestamp: opts.timestamp,
      cwd: opts.cwd ?? '/repo',
      gitBranch: opts.gitBranch ?? 'main',
      message: {
        model: 'claude-opus-5',
        content: [],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: opts.cacheRead ?? 100,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        },
      },
    });
  }

  async function writeTranscript(filePath: string, lines: string[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, lines.map((l) => l + '\n').join(''));
  }

  function mainTranscriptPath(home: string, slug: string, sessionId: string): string {
    return join(home, '.claude', 'projects', slug, `${sessionId}.jsonl`);
  }

  describe('full scan', () => {
    it('should scan a fresh main transcript into a session rollup', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 100 }),
        usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 200 }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions).toHaveLength(1);
      const [session] = result.sessions;
      expect(session.scan.session.sessionId).toBe('sess-1');
      expect(session.scan.session.slug).toBe('-repo');
      expect(session.scan.session.apiCalls).toBe(2);
      expect(session.scan.session.cacheReadTokens).toBe(300);
      expect(session.scan.session.isSubagent).toBe(false);
      expect(session.meta).toBeNull();
    });

    it('should read session-meta enrichment when present', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);

      const metaDir = join(homeDir, '.claude', 'usage-data', 'session-meta');
      await mkdir(metaDir, { recursive: true });
      await writeFile(
        join(metaDir, 'sess-1.json'),
        JSON.stringify({
          duration_minutes: 42,
          first_prompt: 'fix the bug',
          lines_added: 10,
          lines_removed: 3,
          files_modified: 2,
          git_commits: 1,
          tool_errors: 0,
        }),
      );

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].meta).toEqual({
        durationMinutes: 42,
        firstPrompt: 'fix the bug',
        linesAdded: 10,
        linesRemoved: 3,
        filesModified: 2,
        gitCommits: 1,
        toolErrors: 0,
      });
    });

    it('should not throw when session-meta is missing', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].meta).toBeNull();
    });

    it('[FR-USAGE-030] should skip a malformed line without aborting the scan', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        '{"cache_read_input_tokens": broken',
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 55 }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].scan.session.cacheReadTokens).toBe(55);
    });
  });

  describe('subagent transcripts', () => {
    it('[FR-USAGE-040] [FR-USAGE-050] should scan subagent transcripts under <sessionId>/subagents and link the parent', async () => {
      homeDir = await makeHome();
      const sessionDir = join(homeDir, '.claude', 'projects', '-repo', 'sess-1');
      const subagentPath = join(sessionDir, 'subagents', 'agent-abc123.jsonl');
      await writeTranscript(subagentPath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 999 }),
      ]);
      await writeFile(
        join(sessionDir, 'subagents', 'agent-abc123.meta.json'),
        JSON.stringify({ agentType: 'general-purpose', description: 'Memory capture handler' }),
      );

      // A sibling tool-results dir must never be treated as a transcript source.
      await mkdir(join(sessionDir, 'tool-results'), { recursive: true });
      await writeFile(join(sessionDir, 'tool-results', 'blob.txt'), 'not a transcript');

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions).toHaveLength(1);
      const [session] = result.sessions;
      expect(session.scan.session.sessionId).toBe('agent-abc123');
      expect(session.scan.session.isSubagent).toBe(true);
      expect(session.scan.session.parentSessionId).toBe('sess-1');
      expect(session.scan.session.agentType).toBe('general-purpose');
      expect(session.scan.session.agentDescription).toBe('Memory capture handler');
      expect(session.scan.session.cacheReadTokens).toBe(999);
      expect(Object.keys(result.files).some((p) => p.includes('tool-results'))).toBe(false);
    });

    it('[FR-USAGE-050] should not throw when the subagent meta sidecar is missing', async () => {
      homeDir = await makeHome();
      const sessionDir = join(homeDir, '.claude', 'projects', '-repo', 'sess-1');
      const subagentPath = join(sessionDir, 'subagents', 'agent-xyz.jsonl');
      await writeTranscript(subagentPath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].scan.session.agentType).toBeNull();
    });
  });

  describe('streaming reads', () => {
    it('[FR-USAGE-010] should never read a whole transcript into memory', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 100 }),
        usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 200 }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].scan.session.cacheReadTokens).toBe(300);
      expect(wholeFileReads.filter((target) => target.endsWith('.jsonl'))).toEqual([]);
    });

    it('[FR-USAGE-010] should hold only one line at a time regardless of transcript size', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-big');
      const lines: string[] = [];
      for (let i = 0; i < 40_000; i += 1) {
        lines.push(usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 10 }));
      }
      await writeTranscript(filePath, lines);

      forceGc();
      const before = process.memoryUsage().heapUsed;
      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });
      forceGc();
      const growth = process.memoryUsage().heapUsed - before;

      expect(result.sessions[0].scan.session.apiCalls).toBe(40_000);
      const fileSize = (await stat(filePath)).size;
      expect(growth).toBeLessThan(fileSize / 10);
    });
  });

  describe('changed files', () => {
    it('[FR-USAGE-200] should skip a file whose size and mtime are unchanged', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);

      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });
      const second = await scanUsage({
        homeDir,
        knownFiles: first.files,
        sealedDates: new Set(),
      });

      expect(second.sessions).toHaveLength(0);
      expect(second.files[filePath]).toEqual(first.files[filePath]);
    });

    it('[FR-USAGE-205] should read a grown file again from byte 0', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 10 }),
        usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 20 }),
      ]);
      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });
      expect(first.sessions[0].scan.session.apiCalls).toBe(2);

      await appendFile(filePath, usageLine({ timestamp: '2026-01-05T12:00:00.000Z', cacheRead: 30 }) + '\n');

      const second = await scanUsage({
        homeDir,
        knownFiles: first.files,
        sealedDates: new Set(),
      });

      expect(second.sessions).toHaveLength(1);
      expect(second.sessions[0].scan.session.apiCalls).toBe(3);
      expect(second.sessions[0].scan.session.cacheReadTokens).toBe(60);
    });

    it('[FR-USAGE-205] should charge content from an earlier read to the calls appended after it', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      const skillListing = JSON.stringify({
        type: 'attachment',
        timestamp: '2026-01-05T10:00:00.000Z',
        attachment: { type: 'skill_listing', content: 'x'.repeat(360) },
      });
      await writeTranscript(filePath, [
        skillListing,
        usageLine({ timestamp: '2026-01-05T10:01:00.000Z' }),
      ]);
      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      await appendFile(
        filePath,
        [
          usageLine({ timestamp: '2026-01-05T10:02:00.000Z' }),
          usageLine({ timestamp: '2026-01-05T10:03:00.000Z' }),
        ].join('\n') + '\n',
      );
      const second = await scanUsage({ homeDir, knownFiles: first.files, sealedDates: new Set() });

      const attachmentTurns = (result: typeof first) =>
        result.sessions[0].scan.causes.find((cause) => cause.kind === 'attachment')?.tokenTurns;
      expect(attachmentTurns(first)).toBeCloseTo(100, 5);
      expect(attachmentTurns(second)).toBeCloseTo(300, 5);
    });

    it('[FR-USAGE-205] should read lines on a sealed date when it reads a changed file', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 100 }),
        usageLine({ timestamp: '2026-01-06T10:00:00.000Z', cacheRead: 200 }),
      ]);

      const result = await scanUsage({
        homeDir,
        knownFiles: {},
        sealedDates: new Set(['2026-01-05']),
      });

      expect(result.sessions[0].scan.session.apiCalls).toBe(2);
      expect(result.sessions[0].scan.days.map((day) => day.date)).toEqual([
        '2026-01-05',
        '2026-01-06',
      ]);
    });

    it('[FR-USAGE-205] should read a shrunk file again from byte 0', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 10 }),
        usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 20 }),
      ]);
      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-06T10:00:00.000Z', cacheRead: 5 }),
      ]);
      const shrunkStats = await stat(filePath);
      expect(shrunkStats.size).toBeLessThan(first.files[filePath].sizeBytes);

      const second = await scanUsage({
        homeDir,
        knownFiles: first.files,
        sealedDates: new Set(),
      });

      expect(second.sessions).toHaveLength(1);
      expect(second.sessions[0].scan.session.apiCalls).toBe(1);
      expect(second.sessions[0].scan.session.cacheReadTokens).toBe(5);
    });
  });

  describe('range-scoped scan (since)', () => {
    it('[FR-USAGE-380] should skip a file older than the window without recording it as scanned', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);
      const oldDate = new Date('2026-01-06T00:00:00.000Z');
      await utimes(filePath, oldDate, oldDate);

      const result = await scanUsage({
        homeDir,
        knownFiles: {},
        sealedDates: new Set(),
        since: '2026-06-01',
      });

      expect(result.sessions).toHaveLength(0);
      expect(result.files[filePath]).toBeUndefined();
    });

    it('[FR-USAGE-380] should read a skipped file in full on a later scan with no window', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 700 }),
      ]);
      const oldDate = new Date('2026-01-06T00:00:00.000Z');
      await utimes(filePath, oldDate, oldDate);

      const windowed = await scanUsage({
        homeDir,
        knownFiles: {},
        sealedDates: new Set(),
        since: '2026-06-01',
      });
      expect(windowed.sessions).toHaveLength(0);

      // Recording the skipped file here would make the file look unchanged and
      // lose its history for good.
      const full = await scanUsage({
        homeDir,
        knownFiles: windowed.files,
        sealedDates: new Set(),
      });

      expect(full.sessions).toHaveLength(1);
      expect(full.sessions[0].scan.session.cacheReadTokens).toBe(700);
    });

    it('[FR-USAGE-380] should carry a known file forward unchanged when the window skips it', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);

      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });
      const oldDate = new Date('2026-01-06T00:00:00.000Z');
      await utimes(filePath, oldDate, oldDate);

      const windowed = await scanUsage({
        homeDir,
        knownFiles: first.files,
        sealedDates: new Set(),
        since: '2026-06-01',
      });

      expect(windowed.files[filePath]).toEqual(first.files[filePath]);
    });

    it('[FR-USAGE-380] should still read a file whose mtime falls inside the window', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-06-05T10:00:00.000Z' })]);
      const recentDate = new Date('2026-06-05T10:00:00.000Z');
      await utimes(filePath, recentDate, recentDate);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set(), since: '2026-06-01' });

      expect(result.sessions).toHaveLength(1);
    });

    it('[FR-USAGE-380] should read a skipped file in full once new activity moves it into the window', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);
      const oldDate = new Date('2026-01-06T00:00:00.000Z');
      await utimes(filePath, oldDate, oldDate);
      const preClaimed = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set(), since: '2026-06-01' });
      expect(preClaimed.sessions).toHaveLength(0);

      await appendFile(filePath, usageLine({ timestamp: '2026-06-05T09:00:00.000Z' }) + '\n');
      const recentDate = new Date('2026-06-05T09:00:00.000Z');
      await utimes(filePath, recentDate, recentDate);

      const resumed = await scanUsage({
        homeDir,
        knownFiles: preClaimed.files,
        sealedDates: new Set(),
        since: '2026-06-01',
      });

      expect(resumed.sessions).toHaveLength(1);
      expect(resumed.sessions[0].scan.session.apiCalls).toBe(2);
    });
  });

  describe('windowed scan sealing', () => {
    it('[FR-USAGE-380] should seal nothing when the scan skipped an unread file, and recover it on the next unwindowed scan', async () => {
      homeDir = await makeHome();
      // Skipped by the window: mtime is January, well before `since`.
      const skippedPath = mainTranscriptPath(homeDir, '-repo', 'sess-skipped');
      await writeTranscript(skippedPath, [
        usageLine({ timestamp: '2026-01-10T10:00:00.000Z', cacheRead: 777 }),
      ]);
      const januaryDate = new Date('2026-01-10T00:00:00.000Z');
      await utimes(skippedPath, januaryDate, januaryDate);

      // Read by the window (June mtime), but its first line dates back to
      // January — a long-running session that never rotated its transcript.
      const longRunningPath = mainTranscriptPath(homeDir, '-repo', 'sess-long-running');
      await writeTranscript(longRunningPath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 10 }),
        usageLine({ timestamp: '2026-06-02T10:00:00.000Z', cacheRead: 20 }),
      ]);
      const juneDate = new Date('2026-06-02T10:00:00.000Z');
      await utimes(longRunningPath, juneDate, juneDate);

      const windowed = await scanUsage({
        homeDir,
        knownFiles: {},
        sealedDates: new Set(),
        since: '2026-06-01',
      });

      expect(windowed.newlySealedDates).toEqual([]);

      const unwindowed = await scanUsage({
        homeDir,
        knownFiles: windowed.files,
        sealedDates: new Set(windowed.newlySealedDates),
      });

      const recovered = unwindowed.sessions.find(
        (s) => s.scan.session.sessionId === 'sess-skipped',
      );
      expect(recovered?.scan.session.cacheReadTokens).toBe(777);
    });
  });

  describe('sealed days', () => {
    it('[FR-USAGE-180] should seal every past date, not stop at the oldest finished file', async () => {
      homeDir = await makeHome();
      await writeTranscript(mainTranscriptPath(homeDir, '-repo', 'sess-a'), [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z' }),
        usageLine({ timestamp: '2026-01-07T10:00:00.000Z' }),
      ]);
      // A session that finished long ago must not hold the seal boundary back:
      // if it were ever resumed its new lines would be stamped today, not 01-06.
      await writeTranscript(mainTranscriptPath(homeDir, '-repo', 'sess-b'), [
        usageLine({ timestamp: '2026-01-06T10:00:00.000Z' }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.newlySealedDates).toContain('2026-01-05');
      expect(result.newlySealedDates).toContain('2026-01-06');
      expect(result.newlySealedDates).toContain('2026-01-07');
      expect(result.newlySealedDates[0]).toBe('2026-01-05');
    });

    it('[FR-USAGE-180] should never seal today', async () => {
      homeDir = await makeHome();
      const today = new Date();
      const iso = today.toISOString();
      await writeTranscript(mainTranscriptPath(homeDir, '-repo', 'sess-a'), [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z' }),
        usageLine({ timestamp: iso }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      const localToday = new Date(
        today.getTime() - today.getTimezoneOffset() * 60_000,
      )
        .toISOString()
        .slice(0, 10);
      expect(result.newlySealedDates).not.toContain(localToday);
    });

    it('[FR-USAGE-180] should not re-report a date that is already sealed', async () => {
      homeDir = await makeHome();
      await writeTranscript(mainTranscriptPath(homeDir, '-repo', 'sess-a'), [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z' }),
        usageLine({ timestamp: '2026-01-07T10:00:00.000Z' }),
      ]);

      const result = await scanUsage({
        homeDir,
        knownFiles: {},
        sealedDates: new Set(['2026-01-05', '2026-01-06']),
      });

      expect(result.newlySealedDates).not.toContain('2026-01-05');
      expect(result.newlySealedDates).not.toContain('2026-01-06');
      expect(result.newlySealedDates).toContain('2026-01-07');
    });
  });

  describe('local time zones', () => {
    it('[FR-USAGE-170] should bucket a line by its local date and not seal it while still that local day (UTC+)', async () => {
      vi.stubEnv('TZ', 'Europe/Berlin');
      // Berlin is UTC+2 in September, so this UTC instant is 2026-09-19T00:25 local —
      // early on local Sept 19, not Sept 18 as a raw UTC slice would read it.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-19T08:00:00.000Z'));

      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-09-18T22:25:00.000Z' })]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].scan.days[0].date).toBe('2026-09-19');
      expect(result.newlySealedDates).not.toContain('2026-09-18');
      expect(result.newlySealedDates).toHaveLength(0);
    });

    it('[FR-USAGE-170] should bucket a line by its local date (UTC-)', async () => {
      vi.stubEnv('TZ', 'America/New_York');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-20T08:00:00.000Z'));

      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [usageLine({ timestamp: '2026-09-19T23:30:00.000Z' })]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].scan.days[0].date).toBe('2026-09-19');
    });
  });

  describe('partial trailing line', () => {
    it('should not count a line until it is newline-terminated', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      const completeLine = usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 100 });
      const partialLine = usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 200 });
      await mkdir(dirname(filePath), { recursive: true });
      // The second line has no trailing newline yet — as if the scan ran
      // while this line was still being written.
      await writeFile(filePath, `${completeLine}\n${partialLine}`);

      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(first.sessions[0].scan.session.apiCalls).toBe(1);
      expect(first.sessions[0].scan.session.cacheReadTokens).toBe(100);

      await appendFile(filePath, '\n');
      const second = await scanUsage({ homeDir, knownFiles: first.files, sealedDates: new Set() });

      expect(second.sessions).toHaveLength(1);
      expect(second.sessions[0].scan.session.apiCalls).toBe(2);
      expect(second.sessions[0].scan.session.cacheReadTokens).toBe(300);
    });
  });

  describe('worktree repoRoot resolution', () => {
    it('[FR-USAGE-220] should derive repoRoot from the nearest ancestor .git', async () => {
      homeDir = await makeHome();
      const repoDir = join(homeDir, 'repo');
      await mkdir(join(repoDir, '.git'), { recursive: true });
      await writeTranscript(mainTranscriptPath(homeDir, '-repo', 'sess-1'), [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cwd: repoDir }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].repoRoot).toBe(repoDir);
    });

    it('[FR-USAGE-220] should collapse a .claude/worktrees/<name> cwd back to the parent repo', async () => {
      homeDir = await makeHome();
      const repoDir = join(homeDir, 'repo');
      const worktreeDir = join(repoDir, '.claude', 'worktrees', 'feature');
      await mkdir(join(repoDir, '.git'), { recursive: true });
      await mkdir(join(worktreeDir, '.git'), { recursive: true });
      await writeTranscript(mainTranscriptPath(homeDir, '-repo-worktree', 'sess-1'), [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cwd: join(worktreeDir, 'web', 'src') }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].repoRoot).toBe(repoDir);
    });

    it('[FR-USAGE-220] should return a null repoRoot when no cwd was ever recorded', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, ['{"type":"summary","leafUuid":"abc"}']);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].repoRoot).toBeNull();
    });
  });
});
