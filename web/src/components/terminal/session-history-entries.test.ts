import { describe, it, expect } from 'vitest';
import {
  buildSessionHistoryGroup,
  relativeTime,
  type SessionHistoryItem,
} from './session-history-entries';

const NOW = new Date('2026-07-22T12:00:00.000Z').getTime();

function makeRow(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    sessionId: 'sess-1',
    agentType: 'claude',
    workingDir: '/repos/engy',
    scopeLabel: 'claude: engy',
    summary: 'Fixing the diff viewer',
    workspaceSlug: 'ws1',
    projectSlug: 'initial',
    worktreeBranch: null,
    containerMode: null,
    startedAt: '2026-07-22T10:00:00.000Z',
    closedAt: '2026-07-22T11:00:00.000Z',
    ...overrides,
  };
}

const baseOpts = {
  workspaceSlug: 'ws1',
  mcpUrl: undefined,
  agentSettings: undefined,
  now: NOW,
};

describe('session history entries', () => {
  describe('relativeTime', () => {
    it('should format minutes, hours, and days', () => {
      expect(relativeTime('2026-07-22T11:58:30.000Z', NOW)).toBe('2m ago');
      expect(relativeTime('2026-07-22T09:00:00.000Z', NOW)).toBe('3h ago');
      expect(relativeTime('2026-07-19T12:00:00.000Z', NOW)).toBe('3d ago');
      expect(relativeTime('2026-07-22T11:59:59.000Z', NOW)).toBe('just now');
    });
  });

  describe('buildSessionHistoryGroup', () => {
    it('[FR-TERMINAL-360] should build a resume entry whose command resumes the session id', () => {
      const group = buildSessionHistoryGroup([makeRow()], baseOpts);

      const entry = group!.entries[0].children![0];
      expect(entry.label).toBe('Fixing the diff viewer · 1h ago');
      expect(entry.scope).toMatchObject({
        workingDir: '/repos/engy',
        agentType: 'claude',
        resumedFrom: 'sess-1',
        projectSlug: 'initial',
        groupKey: 'project:ws1:initial',
      });
      expect(entry.scope!.command).toContain("claude --resume 'sess-1'");
      expect(entry.scope!.command).not.toContain('--session-id');
    });

    it('[FR-TERMINAL-360] should group entries per repo/worktree directory', () => {
      const group = buildSessionHistoryGroup(
        [
          makeRow({ sessionId: 'a', workingDir: '/repos/engy' }),
          makeRow({
            sessionId: 'b',
            workingDir: '/worktrees/feat',
            worktreeBranch: 'feat',
            closedAt: '2026-07-22T11:30:00.000Z',
          }),
        ],
        baseOpts,
      );

      expect(group!.entries.map((e) => e.label)).toEqual(['feat (feat)', 'engy']);
      expect(group!.entries.every((e) => e.children)).toBe(true);
    });

    it('should cap entries per directory and fall back to scopeLabel for empty summaries', () => {
      const rows = Array.from({ length: 12 }, (_, i) =>
        makeRow({ sessionId: `s${i}`, summary: i === 0 ? '' : `work ${i}` }),
      );
      const group = buildSessionHistoryGroup(rows, baseOpts);

      const children = group!.entries[0].children!;
      expect(children).toHaveLength(10);
      expect(children[0].label).toBe('claude: engy · 1h ago');
    });

    it('should offer nothing for codex rows when codex is inactive', () => {
      expect(
        buildSessionHistoryGroup([makeRow({ agentType: 'codex' })], baseOpts),
      ).toBeUndefined();
    });

    it('[FR-TERMINAL-370] should add a codex picker only where codex sessions ran', () => {
      const group = buildSessionHistoryGroup(
        [
          makeRow(),
          makeRow({ sessionId: 'cx', agentType: 'codex', workingDir: '/repos/engy' }),
          makeRow({ sessionId: 'cx2', agentType: 'codex', workingDir: '/repos/codex-only' }),
        ],
        { ...baseOpts, codexActive: true },
      );

      const engy = group!.entries.find((e) => e.label === 'engy')!;
      const picker = engy.children!.at(-1)!;
      expect(picker.label).toBe('Resume Codex session…');
      expect(picker.scope!.command).toBe('codex resume');
      expect(picker.scope!.agentType).toBe('codex');

      const codexOnly = group!.entries.find((e) => e.label === 'codex-only')!;
      expect(codexOnly.children).toHaveLength(1);
      expect(codexOnly.children![0].label).toBe('Resume Codex session…');
    });

    it('[FR-TERMINAL-370] should not create directory entries for repos without history', () => {
      const group = buildSessionHistoryGroup([makeRow()], { ...baseOpts, codexActive: true });

      expect(group!.entries.map((e) => e.label)).toEqual(['engy']);
      expect(group!.entries[0].children!.every((c) => c.label !== 'Resume Codex session…')).toBe(
        true,
      );
    });

    it('should return undefined when there is nothing to offer', () => {
      expect(buildSessionHistoryGroup([], baseOpts)).toBeUndefined();
    });
  });
});
