// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollapsibleRailGroup } from './collapsible-rail-group';
import type { TerminalTab } from './types';

function tab(sessionId: string, needsAttention = false): TerminalTab {
  return {
    sessionId,
    status: 'active',
    needsAttention,
    scope: {
      scopeType: 'project',
      scopeLabel: `t-${sessionId}`,
      workingDir: '/tmp',
      groupKey: 'gk',
      workspaceSlug: 'ws',
    },
  };
}

function render(open: boolean, tabs: TerminalTab[]) {
  return renderToStaticMarkup(
    createElement(
      CollapsibleRailGroup,
      {
        label: 'feature-branch',
        accessibleName: 'worktree feature-branch',
        tabs,
        open,
        onOpenChange: () => {},
        actions: createElement('button', { 'aria-label': 'New terminal' }),
      },
      createElement('div', null, 'terminal rows'),
    ),
  );
}

describe('CollapsibleRailGroup', () => {
  describe('when open', () => {
    it('[FR-TERMINAL-980] should show the rows and no hidden count', () => {
      const html = render(true, [tab('a'), tab('b', true)]);
      expect(html).toContain('terminal rows');
      expect(html).toContain('aria-label="Collapse worktree feature-branch"');
      expect(html).not.toContain('Needs attention');
    });
  });

  describe('when collapsed', () => {
    it('[FR-TERMINAL-980] should hide the rows and show the hidden terminal count', () => {
      const html = render(false, [tab('a'), tab('b'), tab('c')]);
      expect(html).not.toContain('terminal rows');
      expect(html).toContain('aria-label="Expand worktree feature-branch, 3 hidden"');
      expect(html).toMatch(/>3<\/span>/);
      expect(html).not.toContain('Needs attention');
    });

    it('[FR-TERMINAL-980] should show the attention mark when a hidden terminal needs attention', () => {
      const html = render(false, [tab('a'), tab('b', true)]);
      expect(html).toContain('Needs attention');
      expect(html).toContain(
        'aria-label="Expand worktree feature-branch, 2 hidden, needs attention"',
      );
    });

    it('[FR-TERMINAL-980] should keep the actions outside the toggle', () => {
      const html = render(false, [tab('a')]);
      const toggleEnd = html.indexOf('</button>');
      expect(html.indexOf('aria-label="New terminal"')).toBeGreaterThan(toggleEnd);
    });
  });
});
