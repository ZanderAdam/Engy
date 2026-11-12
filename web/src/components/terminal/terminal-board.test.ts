// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionListItem } from './session-to-tab';
import { TerminalBoardSection } from './terminal-board';
import { groupTerminalsByLane } from './terminal-board-model';

function session(sessionId: string, activityState: SessionListItem['activityState']) {
  return {
    sessionId,
    scopeType: 'project',
    scopeLabel: 'project: initial',
    workingDir: '/repo',
    activityState,
    status: 'active',
    browserCount: 1,
  } satisfies SessionListItem;
}

function render(open: boolean) {
  const lanes = groupTerminalsByLane([
    session('a', 'active'),
    session('b', 'active'),
    session('c', 'waiting'),
  ]);
  return renderToStaticMarkup(
    createElement(
      TerminalBoardSection,
      { open, onOpenChange: () => {}, lanes },
      createElement('div', null, 'board lanes'),
    ),
  );
}

describe('TerminalBoardSection', () => {
  describe('when open', () => {
    it('[FR-TERMINAL-1160] should show the lanes behind an expanded Terminals toggle', () => {
      const html = render(true);

      expect(html).toContain('board lanes');
      expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*>.*Terminals<\/button>/);
      expect(html).not.toContain('Working 2');
    });
  });

  describe('when collapsed', () => {
    it('[FR-TERMINAL-1160] should hide the lanes and show a count per non-empty lane', () => {
      const html = render(false);

      expect(html).not.toContain('board lanes');
      expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Terminals<\/button>/);
      expect(html).toContain('Working 2');
      expect(html).toContain('Waiting 1');
      expect(html).not.toContain('Done 0');
    });
  });
});
