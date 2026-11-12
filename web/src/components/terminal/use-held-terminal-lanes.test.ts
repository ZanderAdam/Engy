// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionListItem } from './session-to-tab';
import { LANE_HOLD_MS } from './terminal-board-model';
import { useHeldTerminalLanes } from './use-held-terminal-lanes';

function session(activityState: SessionListItem['activityState']): SessionListItem {
  return {
    sessionId: 's1',
    scopeType: 'project',
    scopeLabel: 'project: initial',
    workingDir: '/repo',
    activityState,
    status: 'active',
    browserCount: 1,
  };
}

function ShownLane({ sessions }: { sessions: SessionListItem[] }) {
  const laneOf = useHeldTerminalLanes(sessions);
  return createElement('span', null, laneOf(sessions[0]));
}

describe('useHeldTerminalLanes', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const show = (sessions: SessionListItem[]) =>
    act(() => root.render(createElement(ShownLane, { sessions })));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  describe('lane hold', () => {
    it('[FR-TERMINAL-1170] should move the card only after the new lane holds for the hold time', () => {
      show([session('active')]);
      act(() => vi.advanceTimersByTime(0));

      show([session('done')]);
      act(() => vi.advanceTimersByTime(LANE_HOLD_MS - 1));
      expect(container.textContent).toBe('active');

      act(() => vi.advanceTimersByTime(1));
      expect(container.textContent).toBe('done');
    });

    it('[FR-TERMINAL-1170] should keep the card when the state flips back inside the hold time', () => {
      show([session('active')]);
      act(() => vi.advanceTimersByTime(0));

      show([session('done')]);
      act(() => vi.advanceTimersByTime(1_000));
      show([session('active')]);
      act(() => vi.advanceTimersByTime(LANE_HOLD_MS));

      expect(container.textContent).toBe('active');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
