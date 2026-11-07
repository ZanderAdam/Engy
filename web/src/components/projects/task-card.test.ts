// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Task } from './types';

const query = { useQuery: () => ({ data: undefined }) };
const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    taskGroup: { list: query },
    question: { unansweredByTask: query },
    task: { update: mutation },
  },
}));
vi.mock('@/components/tabs/tab-context', () => ({
  useVirtualParams: () => ({ workspace: 'ws', project: 'proj' }),
  useTabId: () => 'tab',
}));
vi.mock('@/hooks/use-task-terminals', () => ({
  useTaskTerminals: () => new Map([[1, [{ sessionId: 's1', scopeLabel: 'impl: T-1' }]]]),
}));
vi.mock('@/hooks/use-terminal-activity', () => ({ useTerminalActivity: () => 'idle' }));
vi.mock('@/hooks/use-execution-status', () => ({
  useExecutionStatus: () => ({ status: null, isActive: false, start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('@/hooks/use-task-has-plan', () => ({
  useTaskHasPlan: () => ({ hasPlan: false, taskSlug: 'ws-T1', planFilePath: null }),
}));
vi.mock('@/hooks/use-quick-action', () => ({
  useQuickAction: () => ({ disabled: false, launch: vi.fn(), projectSlug: 'proj' }),
}));
vi.mock('@/components/terminal/use-send-to-terminal', () => ({
  useSendToTerminal: () => ({ focusTerminal: vi.fn() }),
}));

const { TaskCard } = await import('./task-card');

const task: Task = {
  id: 1,
  projectId: 1,
  milestoneRef: null,
  taskGroupId: null,
  title: 'Do it',
  description: null,
  status: 'todo',
  type: 'ai',
  importance: null,
  urgency: null,
  subStatus: null,
  needsPlan: false,
  specId: null,
  createdAt: '',
  updatedAt: '',
};

function renderCard() {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    createElement(TaskCard, {
      task,
      showCheckbox: true,
      dragHandleProps: {},
    }),
  );
  return host;
}

describe('TaskCard', () => {
  it('[FR-TASK-350] should give every control on the card an accessible name', () => {
    const controls = [...renderCard().querySelectorAll('button, [role="button"]')];
    const unnamed = controls.filter(
      (el) => !el.getAttribute('aria-label') && !el.textContent?.trim(),
    );

    expect(controls.length).toBeGreaterThan(5);
    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });

  it('[FR-TASK-350] should name each icon action by what it does', () => {
    const labels = [...renderCard().querySelectorAll('[aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        'Drag to move',
        'Mark task done',
        'Copy ws-T1',
        'Start Implementing',
        'More task actions',
        'AI task, switch to Human',
        'Open terminal: impl: T-1',
        'Status: Todo, change status',
      ]),
    );
  });
});
