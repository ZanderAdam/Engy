// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideGroup } from './guide-groups';

const STORAGE_KEY = 'engy:review-group-card-collapsed:v1';

function group(number: number, title: string): GuideGroup<{ path: string }> {
  return {
    id: `chapter-${number}`,
    number,
    chapter: { title, files: ['a.ts'], note: `check ${title}`, explanation: `explain ${title}` },
    files: [{ path: 'a.ts' }],
  };
}

describe('GuideGroupCard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  async function render() {
    const { GuideGroupCard } = await import('./guide-group-card');
    act(() =>
      root.render(
        createElement(
          'div',
          null,
          createElement(GuideGroupCard, { group: group(1, 'First'), total: 2 }),
          createElement(GuideGroupCard, { group: group(2, 'Second'), total: 2 }),
        ),
      ),
    );
  }

  function toggles() {
    return [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetModules();
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  describe('collapse toggle', () => {
    it('[FR-PRREVIEW-360] should show the write-up by default', async () => {
      await render();
      expect(toggles().map((t) => t.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
      expect(container.textContent).toContain('explain First');
      expect(container.textContent).toContain('check Second');
    });

    it('[FR-PRREVIEW-360] should hide the write-up of every card and keep the headers', async () => {
      await render();
      act(() => toggles()[0].click());
      expect(toggles().map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
      expect(container.textContent).not.toContain('explain First');
      expect(container.textContent).not.toContain('check Second');
      expect(container.textContent).toContain('Group 1 of 2');
      expect(container.textContent).toContain('Second');
    });

    it('[FR-PRREVIEW-360] should show the write-up again on a second click', async () => {
      await render();
      act(() => toggles()[0].click());
      act(() => toggles()[1].click());
      expect(container.textContent).toContain('explain First');
      expect(toggles().map((t) => t.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
    });

    it('[FR-PRREVIEW-360] should write the hidden state to localStorage', async () => {
      await render();
      act(() => toggles()[0].click());
      expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
    });

    it('[FR-PRREVIEW-360] should hide the note of the ungrouped card', async () => {
      const { GuideGroupCard } = await import('./guide-group-card');
      const other = { id: 'other', number: 3, chapter: null, files: [{ path: 'b.ts' }] };
      act(() => root.render(createElement(GuideGroupCard, { group: other, total: 3 })));
      expect(container.textContent).toContain('Files the review did not put in a group.');
      act(() => toggles()[0].click());
      expect(container.textContent).not.toContain('Files the review did not put in a group.');
      expect(container.textContent).toContain('Other changes');
    });

    it('[FR-PRREVIEW-360] should keep the hidden state in localStorage across a reload', async () => {
      localStorage.setItem(STORAGE_KEY, '1');
      await render();
      expect(toggles().map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
      act(() => toggles()[0].click());
      expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
    });
  });
});
