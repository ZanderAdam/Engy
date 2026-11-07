import { describe, it, expect } from 'vitest';
import type { TaskExecutionSession, TaskTerminalSession } from '@/server/tasks/sessions';
import { taskSessionAction, taskSessionTitle } from './task-sessions-model';

function terminal(overrides: Partial<TaskTerminalSession> = {}): TaskTerminalSession {
  return {
    kind: 'terminal',
    key: 'k',
    state: 'live',
    terminalSessionId: 'k',
    label: 'impl: task',
    agentType: 'claude',
    workingDir: '/repo',
    groupKey: 'ws:proj',
    workspaceSlug: 'ws',
    projectSlug: 'proj',
    worktreeBranch: null,
    containerMode: null,
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const execution: TaskExecutionSession = {
  kind: 'execution',
  key: 'e',
  status: 'completed',
  executionMode: 'group',
  branch: null,
  worktreePath: null,
  lastActiveAt: '2026-01-01T00:00:00.000Z',
};

describe('task sessions model', () => {
  describe('taskSessionAction', () => {
    it('[FR-TASK-340] should open a live or parked terminal', () => {
      expect(taskSessionAction(terminal({ state: 'live' }))).toBe('open');
      expect(taskSessionAction(terminal({ state: 'parked' }))).toBe('open');
    });

    it('[FR-TASK-340] should resume an ended Claude terminal', () => {
      expect(taskSessionAction(terminal({ state: 'ended', terminalSessionId: null }))).toBe(
        'resume',
      );
    });

    it('[FR-TASK-340] should offer no action for a session with no workspace', () => {
      expect(taskSessionAction(terminal({ state: 'ended', workspaceSlug: null }))).toBeNull();
    });

    it('[FR-TASK-340] should offer no action for an ended Codex terminal or an execution', () => {
      expect(taskSessionAction(terminal({ state: 'ended', agentType: 'codex' }))).toBeNull();
      expect(taskSessionAction(execution)).toBeNull();
    });
  });

  describe('taskSessionTitle', () => {
    it('should name a background run by its mode', () => {
      expect(taskSessionTitle(execution)).toBe('Background group run');
    });
  });
});
