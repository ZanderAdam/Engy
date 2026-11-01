import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppState } from '../trpc/context';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { handleStopBrief, parseRecap } from './brief';
import { addSession, hookPayload } from './test-helpers';

function recapLine(content: string, timestamp: string): string {
  return JSON.stringify({ type: 'system', subtype: 'away_summary', content, timestamp });
}

describe('session brief', () => {
  describe('[FR-TERMINAL-1080] handleStopBrief', () => {
    let ctx: TestContext;
    let state: AppState;

    beforeEach(() => {
      ctx = setupTestDb();
      state = ctx.state;
    });

    afterEach(() => {
      ctx.cleanup();
    });

    it('should keep the transcript path and the whole last reply', () => {
      const meta = addSession(state, 's1');
      const payload = hookPayload('Stop', {
        transcript_path: '/home/me/.claude/projects/repo/conv.jsonl',
        last_assistant_message: 'First line\nSecond line',
      });

      handleStopBrief(payload, meta, state, 's1');

      expect(meta.transcriptPath).toBe('/home/me/.claude/projects/repo/conv.jsonl');
      expect(meta.lastReply).toBe('First line\nSecond line');
      expect(meta.lastStopAt).toEqual(expect.any(Number));
    });

    it('should ignore a Stop from a subagent', () => {
      const meta = addSession(state, 's1');
      const payload = hookPayload('Stop', { agent_id: 'sub', last_assistant_message: 'inner' });

      handleStopBrief(payload, meta, state, 's1');

      expect(meta.lastReply).toBeUndefined();
    });
  });

  describe('[FR-TERMINAL-1085] parseRecap', () => {
    const STOP_AT = Date.parse('2026-10-15T12:00:00.000Z');

    it('should return the newest recap without the CLI footer', () => {
      const transcript = [
        recapLine('Old work.', '2026-10-15T12:01:00.000Z'),
        '{"type":"assistant"}',
        recapLine('New work. Next: ship. (disable recaps in /config)', '2026-10-15T12:05:00.000Z'),
      ].join('\n');

      expect(parseRecap(transcript, STOP_AT)).toBe('New work. Next: ship.');
    });

    it('should ignore a recap older than the last turn', () => {
      const transcript = recapLine('Stale.', '2026-10-15T11:00:00.000Z');

      expect(parseRecap(transcript, STOP_AT)).toBeUndefined();
    });

    it('should treat a recap with no timestamp as no recap', () => {
      const transcript = JSON.stringify({ subtype: 'away_summary', content: 'No time.' });

      expect(parseRecap(transcript, STOP_AT)).toBeUndefined();
    });

    it('should treat a malformed entry as no recap', () => {
      expect(parseRecap('{"subtype":"away_summary"', STOP_AT)).toBeUndefined();
    });
  });
});
