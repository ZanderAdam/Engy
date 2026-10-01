import { describe, it, expect } from 'vitest';
import { getInboxKeyAction } from './use-inbox-keys';

function press(key: string, extra: Partial<Parameters<typeof getInboxKeyAction>[0]> = {}) {
  return getInboxKeyAction({
    key,
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });
}

describe('[FR-INBOX-420] getInboxKeyAction', () => {
  it('should map movement keys', () => {
    expect(press('j')).toBe('next');
    expect(press('ArrowDown')).toBe('next');
    expect(press('k')).toBe('previous');
    expect(press('ArrowUp')).toBe('previous');
  });

  it('should map action keys', () => {
    expect(press('Enter')).toBe('open');
    expect(press('u')).toBe('toggleRead');
    expect(press('e')).toBe('done');
    expect(press('Backspace')).toBe('done');
    expect(press('h')).toBe('snooze');
    expect(press('o')).toBe('github');
    expect(press('/')).toBe('focusFilter');
    expect(press('?')).toBe('help');
  });

  it('should map Alt+u by physical key so macOS option remapping does not hide it', () => {
    expect(press('¨', { altKey: true, code: 'KeyU' })).toBe('markAllRead');
    expect(press('u', { altKey: true, code: 'KeyU' })).toBe('markAllRead');
  });

  it('should ignore other Alt combos and Ctrl or Meta combos', () => {
    expect(press('j', { altKey: true, code: 'KeyJ' })).toBeNull();
    expect(press('j', { ctrlKey: true })).toBeNull();
    expect(press('e', { metaKey: true })).toBeNull();
  });

  it('should ignore unmapped keys', () => {
    expect(press('x')).toBeNull();
    expect(press('J')).toBeNull();
  });
});
