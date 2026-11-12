import { describe, it, expect } from 'vitest';
import {
  buildTerminalPageUrl,
  decideTerminalLinkAction,
  decodeSessionId,
  findResumeScope,
} from './terminal-link';
import type { TerminalDropdownGroup, TerminalScope } from './types';

describe('terminal link', () => {
  describe('buildTerminalPageUrl', () => {
    it('[FR-TERMINAL-1210] should target the project page with the terminal param', () => {
      expect(
        buildTerminalPageUrl({ workspaceSlug: 'ws', projectSlug: 'alpha' }, 'sess-1'),
      ).toBe('/w/ws/projects/alpha?terminal=sess-1');
    });

    it('[FR-TERMINAL-1210] should add the worktree branch as wt', () => {
      expect(
        buildTerminalPageUrl(
          { workspaceSlug: 'ws', projectSlug: 'alpha', worktreeBranch: 'feat/x' },
          'sess-1',
        ),
      ).toBe('/w/ws/projects/alpha?terminal=sess-1&wt=feat%2Fx');
    });

    it('[FR-TERMINAL-1210] should target the workspace page when there is no project', () => {
      expect(buildTerminalPageUrl({ workspaceSlug: 'ws' }, 'sess-1')).toBe(
        '/w/ws?terminal=sess-1',
      );
    });
  });

  describe('decodeSessionId', () => {
    it('[FR-TERMINAL-1220] should decode a path segment', () => {
      expect(decodeSessionId('a%20b')).toBe('a b');
    });

    it('[FR-TERMINAL-1220] should return null for a bad escape or an empty id', () => {
      expect(decodeSessionId('%E0%A4%A')).toBeNull();
      expect(decodeSessionId('')).toBeNull();
    });
  });

  describe('decideTerminalLinkAction', () => {
    const base = { sessionId: 'sess-1', resumeGroup: undefined, resumeGroupReady: true };
    const location = { workspaceSlug: 'ws' };

    it('[FR-TERMINAL-1220] should report not-found when nothing resolved', () => {
      expect(decideTerminalLinkAction({ ...base, target: null })).toEqual({ kind: 'not-found' });
    });

    it('[FR-TERMINAL-1210] should focus a live session in the Claude dock', () => {
      expect(decideTerminalLinkAction({ ...base, target: { ...location, status: 'live' } })).toEqual(
        { kind: 'focus', dock: 'terminal' },
      );
    });

    it('[FR-TERMINAL-1210] should focus a dormant session without restoring it', () => {
      expect(
        decideTerminalLinkAction({ ...base, target: { ...location, status: 'dormant' } }),
      ).toEqual({ kind: 'focus', dock: 'terminal' });
    });

    it('[FR-TERMINAL-1210] should focus a shell session in the shell dock', () => {
      expect(
        decideTerminalLinkAction({
          ...base,
          target: { ...location, status: 'live', shell: true },
        }),
      ).toEqual({ kind: 'focus', dock: 'shell' });
    });

    it('[FR-TERMINAL-1220] should wait for history before judging a closed session', () => {
      expect(
        decideTerminalLinkAction({
          ...base,
          resumeGroupReady: false,
          target: { ...location, status: 'closed' },
        }),
      ).toEqual({ kind: 'wait' });
    });

    it('[FR-TERMINAL-1220] should offer resume for a closed session with a resume entry', () => {
      const resumeScope = { scopeLabel: 'resumed' } as TerminalScope;
      const resumeGroup: TerminalDropdownGroup = {
        entries: [
          {
            id: 'resume-dir:/repo',
            label: 'repo',
            children: [{ id: 'resume:sess-1', label: 'one', scope: resumeScope }],
          },
        ],
      };
      expect(
        decideTerminalLinkAction({
          ...base,
          resumeGroup,
          target: { ...location, status: 'closed' },
        }),
      ).toEqual({ kind: 'closed', resumeScope });
    });

    it('[FR-TERMINAL-1220] should report closed without resume when history has no entry', () => {
      expect(
        decideTerminalLinkAction({ ...base, target: { ...location, status: 'closed' } }),
      ).toEqual({ kind: 'closed', resumeScope: undefined });
    });
  });

  describe('findResumeScope', () => {
    const scope = { scopeLabel: 'resumed' } as TerminalScope;
    const group: TerminalDropdownGroup = {
      label: 'Resume Session',
      entries: [
        {
          id: 'resume-dir:/repo',
          label: 'repo',
          children: [
            { id: 'resume:other', label: 'other', scope: {} as TerminalScope },
            { id: 'resume:sess-1', label: 'one', scope },
          ],
        },
      ],
    };

    it('[FR-TERMINAL-1220] should find the resume scope of a closed session', () => {
      expect(findResumeScope(group, 'sess-1')).toBe(scope);
    });

    it('[FR-TERMINAL-1220] should return undefined when history has no resume entry', () => {
      expect(findResumeScope(group, 'missing')).toBeUndefined();
      expect(findResumeScope(undefined, 'sess-1')).toBeUndefined();
    });
  });
});
