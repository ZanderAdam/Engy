import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, appendFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { scanUsage } from './scan.js';

describe('scanUsage', () => {
  let homeDir: string;

  async function makeHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'engy-usage-scan-test-'));
    return dir;
  }

  afterEach(async () => {
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
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

    it('should skip a malformed line without aborting the scan', async () => {
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
    it('should scan subagent transcripts under <sessionId>/subagents and link the parent', async () => {
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

    it('should not throw when the subagent meta sidecar is missing', async () => {
      homeDir = await makeHome();
      const sessionDir = join(homeDir, '.claude', 'projects', '-repo', 'sess-1');
      const subagentPath = join(sessionDir, 'subagents', 'agent-xyz.jsonl');
      await writeTranscript(subagentPath, [usageLine({ timestamp: '2026-01-05T10:00:00.000Z' })]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].scan.session.agentType).toBeNull();
    });
  });

  describe('incremental scan', () => {
    it('should skip a file whose size and mtime are unchanged', async () => {
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

    it('should resume from the stored byte offset for a grown file', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 10 }),
        usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 20 }),
      ]);
      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });
      expect(first.sessions[0].scan.session.apiCalls).toBe(2);

      await appendFile(filePath, usageLine({ timestamp: '2026-01-05T12:00:00.000Z', cacheRead: 30 }) + '\n');
      const stats = await stat(filePath);
      // mtime resolution can be coarser than the write; force a detectable change
      // so the resume branch (not the unchanged-skip branch) is exercised.
      expect(first.files[filePath].bytesScanned).toBeLessThan(stats.size);

      const second = await scanUsage({
        homeDir,
        knownFiles: first.files,
        sealedDates: new Set(),
      });

      expect(second.sessions).toHaveLength(1);
      // Resume feeds only the newly appended line into a fresh reducer.
      expect(second.sessions[0].scan.session.apiCalls).toBe(1);
      expect(second.sessions[0].scan.session.cacheReadTokens).toBe(30);
      expect(second.files[filePath].bytesScanned).toBe(stats.size);
    });

    it('should fully reparse a shrunk file', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cacheRead: 10 }),
        usageLine({ timestamp: '2026-01-05T11:00:00.000Z', cacheRead: 20 }),
      ]);
      const first = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });
      expect(first.files[filePath].sizeBytes).toBeGreaterThan(0);

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

  describe('sealed days', () => {
    it('should skip lines on an already-sealed date and count staleSealSkips', async () => {
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

      expect(result.sessions[0].scan.session.apiCalls).toBe(1);
      expect(result.sessions[0].scan.session.cacheReadTokens).toBe(200);
      expect(result.staleSealSkips).toBe(1);
    });

    it('should seal every past date, not stop at the oldest finished file', async () => {
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

    it('should never seal today', async () => {
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

    it('should not re-report a date that is already sealed', async () => {
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

  describe('worktree repoRoot resolution', () => {
    it('should derive repoRoot from the nearest ancestor .git', async () => {
      homeDir = await makeHome();
      const repoDir = join(homeDir, 'repo');
      await mkdir(join(repoDir, '.git'), { recursive: true });
      await writeTranscript(mainTranscriptPath(homeDir, '-repo', 'sess-1'), [
        usageLine({ timestamp: '2026-01-05T10:00:00.000Z', cwd: repoDir }),
      ]);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions[0].repoRoot).toBe(repoDir);
    });

    it('should collapse a .claude/worktrees/<name> cwd back to the parent repo', async () => {
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

    it('should return a null repoRoot when no cwd was ever recorded', async () => {
      homeDir = await makeHome();
      const filePath = mainTranscriptPath(homeDir, '-repo', 'sess-1');
      await writeTranscript(filePath, ['{"type":"summary","leafUuid":"abc"}']);

      const result = await scanUsage({ homeDir, knownFiles: {}, sealedDates: new Set() });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].repoRoot).toBeNull();
    });
  });
});
