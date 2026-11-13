import { describe, expect, it } from 'vitest';
import { orchestratorButtonAction } from './orchestrator-button-action';

const dock = { workspaceSlug: 'engy', projectSlug: 'initial' };

describe('orchestratorButtonAction', () => {
  describe('when the project has a live orchestrator', () => {
    it('[FR-TERMINAL-1270] should focus it instead of changing the role', () => {
      const agents = [
        { sessionId: 'worker', orchestrator: false, ...dock },
        { sessionId: 'orch', orchestrator: true, ...dock },
      ];
      expect(orchestratorButtonAction(agents, dock)).toEqual({ kind: 'focus', sessionId: 'orch' });
    });
  });

  describe('when the project has no live orchestrator', () => {
    it('[FR-TERMINAL-1270] should start one', () => {
      const agents = [{ sessionId: 'worker', orchestrator: false, ...dock }];
      expect(orchestratorButtonAction(agents, dock)).toEqual({ kind: 'start' });
    });

    it('[FR-TERMINAL-1270] should ignore the orchestrator of another project', () => {
      const agents = [
        { sessionId: 'other', orchestrator: true, workspaceSlug: 'engy', projectSlug: 'other' },
      ];
      expect(orchestratorButtonAction(agents, dock)).toEqual({ kind: 'start' });
    });

    it('[FR-TERMINAL-1270] should ignore a project orchestrator when the dock is workspace scope', () => {
      const agents = [{ sessionId: 'orch', orchestrator: true, ...dock }];
      expect(orchestratorButtonAction(agents, { workspaceSlug: 'engy' })).toEqual({
        kind: 'start',
      });
    });
  });
});
