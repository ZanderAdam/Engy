import { describe, expect, it } from 'vitest';
import { isInsideOverlay, reviewKeyAction } from './use-review-keys';

function press(
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) {
  return reviewKeyAction({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

describe('[FR-PRREVIEW-260] reviewKeyAction', () => {
  it.each([
    [']', 'nextFile'],
    ['[', 'prevFile'],
    ['n', 'nextThread'],
    ['p', 'prevThread'],
    ['v', 'toggleViewed'],
  ])('should map %s to %s', (key, action) => {
    expect(press(key)).toBe(action);
  });

  it('should map Cmd+B and Ctrl+B to the split toggle', () => {
    expect(press('b', { metaKey: true })).toBe('toggleSplit');
    expect(press('B', { ctrlKey: true })).toBe('toggleSplit');
  });

  it('should ignore plain b and unmapped keys', () => {
    expect(press('b')).toBeNull();
    expect(press('x')).toBeNull();
  });

  it('should ignore plain keys pressed with a modifier', () => {
    expect(press('n', { ctrlKey: true })).toBeNull();
    expect(press('v', { metaKey: true })).toBeNull();
    expect(press('p', { altKey: true })).toBeNull();
    expect(press('n', { shiftKey: true })).toBeNull();
  });
});

describe('[FR-PRREVIEW-260] isInsideOverlay', () => {
  const within = (selector: string) => ({
    closest: (query: string) => (query.includes(selector) ? {} : null),
  });

  it.each([
    '[role="dialog"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[data-radix-popper-content-wrapper]',
  ])('should be true inside %s', (selector) => {
    expect(isInsideOverlay(within(selector) as unknown as Element)).toBe(true);
  });

  it('should be false outside an overlay or with no focus', () => {
    expect(isInsideOverlay({ closest: () => null })).toBe(false);
    expect(isInsideOverlay(null)).toBe(false);
  });
});
