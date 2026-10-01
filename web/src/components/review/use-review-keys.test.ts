import { describe, expect, it } from 'vitest';
import { reviewKeyAction } from './use-review-keys';

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
