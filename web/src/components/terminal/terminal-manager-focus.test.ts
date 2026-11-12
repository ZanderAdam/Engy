// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalManager } from './terminal-manager';
import type { TerminalScope } from './types';

const SESSIONS = ['session-a', 'session-b'].map((sessionId) => ({
  sessionId,
  scopeLabel: sessionId,
  groupKey: 'group',
  workingDir: '/repo',
}));

function createFakeDock() {
  const panels = new Map<string, { id: string; api: Record<string, unknown> }>();
  const onEvent = () => ({ dispose: () => {} });
  const dock = {
    activePanel: undefined as { id: string } | undefined,
    panels: [] as { id: string }[],
    onDidActivePanelChange: onEvent,
    onDidRemovePanel: onEvent,
    onDidAddPanel: onEvent,
    onDidMovePanel: onEvent,
    onDidAddGroup: onEvent,
    onDidRemoveGroup: onEvent,
    getPanel: (id: string) => panels.get(id),
    addPanel({ id }: { id: string }) {
      const panel = {
        id,
        api: {
          setActive: () => {
            dock.activePanel = panel;
          },
        },
      };
      panels.set(id, panel);
      dock.panels.push(panel);
      dock.activePanel = panel;
    },
  };
  return dock;
}

const dockview = vi.hoisted(() => ({ docks: [] as ReturnType<typeof createFakeDock>[] }));

vi.mock('dockview', () => ({
  DockviewReact: ({ onReady }: { onReady: (event: { api: unknown }) => void }) => {
    useEffect(() => {
      for (let mount = 0; mount < 2; mount += 1) {
        const dock = createFakeDock();
        dockview.docks.push(dock);
        onReady({ api: dock });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
}));

vi.mock('@/contexts/events-context', () => ({
  useOnServerEvent: () => {},
  useOnEventsConnect: () => {},
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    terminal: { discardDormantSession: { useMutation: () => ({ mutate: () => {} }) } },
  },
}));

const scope: TerminalScope = {
  scopeType: 'project',
  groupKey: 'group',
  workingDir: '/repo',
  scopeLabel: 'repo',
  workspaceSlug: 'workspace',
};

describe('TerminalManager focus on mount', () => {
  let resolveFetches: (() => void)[];
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    root = createRoot(document.createElement('div'));
    dockview.docks = [];
    resolveFetches = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetches.push(() =>
              resolve({ ok: true, json: async () => ({ sessions: SESSIONS }) }),
            );
          }),
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  describe('when dockview mounts twice and a focus request waits for the sessions', () => {
    it('[FR-TERMINAL-1060] should activate the target in the live dock', async () => {
      await act(async () => {
        root.render(
          createElement(TerminalManager, { defaultScope: scope, onCollapse: () => {} }),
        );
      });
      const [disposedDock, liveDock] = dockview.docks;

      act(() => {
        window.dispatchEvent(
          new CustomEvent('terminal:focus', { detail: { sessionId: 'session-a' } }),
        );
      });
      await act(async () => {
        for (const resolve of resolveFetches) resolve();
      });

      expect(liveDock.activePanel?.id).toBe('session-a');
      expect(disposedDock.panels).toHaveLength(0);
    });
  });
});
