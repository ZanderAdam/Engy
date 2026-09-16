// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TerminalSessionLabel } from './terminal-session-label';
import { resolveTerminalLabel } from './terminal-label';
import type { TerminalTab } from './types';

function tab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    sessionId: 'sess-1',
    status: 'connecting',
    scope: {
      scopeType: 'project',
      scopeLabel: 'claude: web',
      workingDir: '/repo/web',
      groupKey: 'project:ws:alpha',
      workspaceSlug: 'ws',
    },
    ...overrides,
  };
}

function render(t: TerminalTab): string {
  return renderToStaticMarkup(createElement(TerminalSessionLabel, { tab: t }));
}

describe('resolveTerminalLabel', () => {
  it('should prefer renamedLabel when both renamedLabel and oscTitle are set', () => {
    const label = resolveTerminalLabel(
      {
        scopeType: 'project',
        scopeLabel: 'claude: web',
        workingDir: '/repo',
        groupKey: 'g',
        workspaceSlug: 'ws',
        renamedLabel: 'my rename',
      },
      'agent title',
    );
    expect(label).toBe('my rename');
  });

  it('should fall back to oscTitle when renamedLabel is unset', () => {
    const label = resolveTerminalLabel(
      {
        scopeType: 'project',
        scopeLabel: 'claude: web',
        workingDir: '/repo',
        groupKey: 'g',
        workspaceSlug: 'ws',
      },
      'agent title',
    );
    expect(label).toBe('agent title');
  });

  it('should prefer renamedLabel over scopeLabel when oscTitle is unset', () => {
    const label = resolveTerminalLabel({
      scopeType: 'project',
      scopeLabel: 'claude: web',
      workingDir: '/repo',
      groupKey: 'g',
      workspaceSlug: 'ws',
      renamedLabel: 'my rename',
    });
    expect(label).toBe('my rename');
  });

  it('should fall back to scopeLabel when neither renamedLabel nor oscTitle is set', () => {
    const label = resolveTerminalLabel({
      scopeType: 'project',
      scopeLabel: 'claude: web',
      workingDir: '/repo',
      groupKey: 'g',
      workspaceSlug: 'ws',
    });
    expect(label).toBe('claude: web');
  });
});

describe('TerminalSessionLabel', () => {
  it('[FR-TERMINAL-660] should render the manual rename as the main line over the agent title and scope label', () => {
    const html = render(
      tab({ oscTitle: 'agent title', scope: { ...tab().scope, renamedLabel: 'my rename' } }),
    );
    expect(html).toContain('my rename');
    expect(html).not.toContain('agent title');
  });

  it('[FR-TERMINAL-660] should render the agent title as the main line when no rename is set', () => {
    const html = render(tab({ oscTitle: 'agent title' }));
    expect(html).toContain('agent title');
  });

  it('[FR-TERMINAL-660] should render the scope label as the main line when neither rename nor title is set', () => {
    const html = render(tab());
    expect(html).toContain('claude: web');
  });

  it('[FR-TERMINAL-680] should leave scopeLabel intact on the tab when a rename is set', () => {
    const t = tab({ scope: { ...tab().scope, renamedLabel: 'my rename' } });
    expect(t.scope.scopeLabel).toBe('claude: web');
  });

  it('[FR-TERMINAL-670] should render the branch as the sub line when set', () => {
    const html = render(tab({ scope: { ...tab().scope, worktreeBranch: 'aadamovic/m14-hooks' } }));
    expect(html).toContain('aadamovic/m14-hooks');
  });

  it('[FR-TERMINAL-670] should render no sub line when the branch is unset', () => {
    const html = render(tab());
    expect(html).not.toContain('font-mono');
  });

  it('[FR-TERMINAL-740] should render the attention indicator when needsAttention is set', () => {
    const html = render(tab({ needsAttention: true }));
    expect(html).toContain('Needs attention');
  });

  it('[FR-TERMINAL-740] should render no attention indicator when needsAttention is unset', () => {
    const html = render(tab());
    expect(html).not.toContain('Needs attention');
  });
});
