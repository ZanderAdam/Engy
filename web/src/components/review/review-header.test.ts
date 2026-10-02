// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PrDetail } from '@/server/github/pr-detail';
import { ReviewHeader } from './review-header';

const detail = {
  title: 'Add the inbox',
  url: 'https://github.com/acme/web/pull/7',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  author: { login: 'alice', avatarUrl: null },
  baseRefName: 'main',
  headRefName: 'feat/inbox',
  ciStatus: 'passing',
  checks: [],
  reviewDecision: null,
  reviewRequests: [],
  additions: 12,
  deletions: 3,
} as unknown as PrDetail;

function render(compact: boolean): string {
  return renderToStaticMarkup(
    createElement(ReviewHeader, {
      prNumber: 7,
      detail,
      onBack: () => {},
      agentReview: null,
      worktreeActions: null,
      compact,
      tabs: createElement('nav', null, 'TABS'),
    }),
  );
}

describe('ReviewHeader', () => {
  describe('compact', () => {
    it('[FR-PRREVIEW-280] should fit the title, tabs and actions in one row without the author and branches', () => {
      const html = render(true);

      expect(html).toContain('Add the inbox');
      expect(html).toContain('TABS');
      expect(html).toContain('aria-label="Open on GitHub"');
      expect(html).not.toContain('alice');
      expect(html).not.toContain('feat/inbox');
    });
  });

  describe('full', () => {
    it('[FR-PRREVIEW-280] should show the author and branches and leave the tabs to the page', () => {
      const html = render(false);

      expect(html).toContain('alice');
      expect(html).toContain('main ← feat/inbox');
      expect(html).not.toContain('TABS');
    });
  });
});
