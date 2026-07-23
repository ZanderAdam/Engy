import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { terminalSessionHistory } from '../db/schema';
import {
  recordSessionStart,
  updateSessionSummary,
  markSessionClosed,
  listSessionHistory,
} from './terminal-session-history';
import type { TerminalSessionMeta } from '../trpc/context';

function makeAgentMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'my-project',
    workingDir: '/home/user/project',
    agentType: 'claude',
    workspaceSlug: 'ws-1',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

describe('terminal session history', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
    return () => ctx.cleanup();
  });

  describe('recordSessionStart', () => {
    it('[FR-TERMINAL-340] should create a row with summary=scopeLabel and closedAt null', () => {
      recordSessionStart('sid-1', makeAgentMeta({ scopeLabel: 'Initial label' }));

      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe('sid-1');
      expect(rows[0].summary).toBe('Initial label');
      expect(rows[0].scopeLabel).toBe('Initial label');
      expect(rows[0].closedAt).toBeNull();
      expect(rows[0].agentType).toBe('claude');
      expect(rows[0].workingDir).toBe('/home/user/project');
      expect(rows[0].workspaceSlug).toBe('ws-1');
    });

    it('[FR-TERMINAL-340] should not create a row when agentType is undefined', () => {
      recordSessionStart('sid-2', makeAgentMeta({ agentType: undefined }));

      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows).toHaveLength(0);
    });

    it('[FR-TERMINAL-340] should use resumedFrom as the row key when set', () => {
      const meta = makeAgentMeta({ resumedFrom: 'original-sid' });
      recordSessionStart('new-sid', meta);

      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe('original-sid');
    });

    it('[FR-TERMINAL-340] should reset closedAt and startedAt on conflict but preserve summary', () => {
      // First spawn
      recordSessionStart('sid-3', makeAgentMeta({ scopeLabel: 'Original scope' }));
      // Accumulate a custom title
      updateSessionSummary('sid-3', 'Custom title from OSC');
      // Mark closed to simulate end of first session
      markSessionClosed('sid-3');

      const before = ctx.db.select().from(terminalSessionHistory).all();
      expect(before[0].closedAt).not.toBeNull();
      const oldStartedAt = before[0].startedAt;

      // Slight delay to ensure startedAt differs
      const nowBefore = Date.now();
      while (Date.now() - nowBefore < 5) {} // spin ≤5ms

      // Resume (re-record same key)
      recordSessionStart('sid-3', makeAgentMeta({ resumedFrom: 'sid-3', scopeLabel: 'New scope' }));

      const after = ctx.db.select().from(terminalSessionHistory).all();
      expect(after).toHaveLength(1);
      expect(after[0].closedAt).toBeNull();
      expect(after[0].startedAt).not.toBe(oldStartedAt);
      // Accumulated title must be preserved
      expect(after[0].summary).toBe('Custom title from OSC');
      // scopeLabel updated to new value
      expect(after[0].scopeLabel).toBe('New scope');
    });

    it('[FR-TERMINAL-340] should prune to 50 newest rows per workspace bucket', () => {
      // Insert 55 rows
      for (let i = 1; i <= 55; i++) {
        recordSessionStart(`sid-prune-${i}`, makeAgentMeta({ workspaceSlug: 'ws-prune' }));
      }

      const rows = ctx.db
        .select()
        .from(terminalSessionHistory)
        .all()
        .filter((r) => r.workspaceSlug === 'ws-prune');

      expect(rows).toHaveLength(50);
    });

    it('[FR-TERMINAL-340] should prune null-slug rows independently from named buckets', () => {
      // 55 null-slug rows
      for (let i = 1; i <= 55; i++) {
        recordSessionStart(`sid-null-${i}`, makeAgentMeta({ workspaceSlug: undefined }));
      }
      // 2 named-slug rows
      recordSessionStart('sid-named-1', makeAgentMeta({ workspaceSlug: 'ws-named' }));
      recordSessionStart('sid-named-2', makeAgentMeta({ workspaceSlug: 'ws-named' }));

      const all = ctx.db.select().from(terminalSessionHistory).all();
      const nullBucket = all.filter((r) => r.workspaceSlug === null);
      const namedBucket = all.filter((r) => r.workspaceSlug === 'ws-named');

      expect(nullBucket).toHaveLength(50);
      expect(namedBucket).toHaveLength(2);
    });
  });

  describe('markSessionClosed', () => {
    it('[FR-TERMINAL-340] should stamp closedAt on an existing row', () => {
      recordSessionStart('sid-close', makeAgentMeta());

      const before = ctx.db.select().from(terminalSessionHistory).all();
      expect(before[0].closedAt).toBeNull();

      markSessionClosed('sid-close');

      const after = ctx.db.select().from(terminalSessionHistory).all();
      expect(after[0].closedAt).not.toBeNull();
      expect(new Date(after[0].closedAt!).getTime()).toBeGreaterThan(0);
    });

    it('[FR-TERMINAL-340] should be a no-op for missing keys', () => {
      expect(() => markSessionClosed('nonexistent')).not.toThrow();
    });
  });

  describe('updateSessionSummary', () => {
    it('should update summary on an existing row', () => {
      recordSessionStart('sid-summary', makeAgentMeta({ scopeLabel: 'original' }));

      updateSessionSummary('sid-summary', 'Updated from OSC title');

      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows[0].summary).toBe('Updated from OSC title');
      // scopeLabel unchanged
      expect(rows[0].scopeLabel).toBe('original');
    });

    it('should be a no-op for missing keys', () => {
      expect(() => updateSessionSummary('nonexistent', 'Title')).not.toThrow();
    });
  });

  describe('listSessionHistory', () => {
    it('[FR-TERMINAL-350] should return rows for the specified workspaceSlug newest-first', () => {
      // Insert out-of-order (use different sessions so startedAt naturally differs slightly)
      recordSessionStart('sid-a', makeAgentMeta({ workspaceSlug: 'ws-list' }));
      recordSessionStart('sid-b', makeAgentMeta({ workspaceSlug: 'ws-list' }));
      recordSessionStart('sid-c', makeAgentMeta({ workspaceSlug: 'ws-list' }));

      const rows = listSessionHistory('ws-list', new Set());
      expect(rows.map((r) => r.sessionId)).toEqual(['sid-c', 'sid-b', 'sid-a']);
    });

    it('[FR-TERMINAL-350] should exclude sessionIds present in liveKeys', () => {
      recordSessionStart('live-1', makeAgentMeta({ workspaceSlug: 'ws-live' }));
      recordSessionStart('hist-1', makeAgentMeta({ workspaceSlug: 'ws-live' }));
      recordSessionStart('hist-2', makeAgentMeta({ workspaceSlug: 'ws-live' }));

      const rows = listSessionHistory('ws-live', new Set(['live-1']));
      expect(rows.map((r) => r.sessionId)).not.toContain('live-1');
      expect(rows).toHaveLength(2);
    });

    it('[FR-TERMINAL-350] should not return rows for a different workspaceSlug', () => {
      recordSessionStart('other-ws-sid', makeAgentMeta({ workspaceSlug: 'ws-other' }));

      const rows = listSessionHistory('ws-list', new Set());
      expect(rows).toHaveLength(0);
    });

    it('[FR-TERMINAL-350] should include rows with null closedAt (crash case)', () => {
      recordSessionStart('crashed-sid', makeAgentMeta({ workspaceSlug: 'ws-crash' }));
      // Do NOT call markSessionClosed — simulates a crash

      const rows = listSessionHistory('ws-crash', new Set());
      expect(rows).toHaveLength(1);
      expect(rows[0].closedAt).toBeNull();
    });

    it('[FR-TERMINAL-350] should return empty array when no history exists', () => {
      const rows = listSessionHistory('ws-empty', new Set());
      expect(rows).toHaveLength(0);
    });
  });
});
