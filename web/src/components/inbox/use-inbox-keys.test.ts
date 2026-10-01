// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { focusOwnsKeys, getInboxKeyAction } from './use-inbox-keys';

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

describe('[FR-INBOX-500] focusOwnsKeys', () => {
  function mount(html: string): Element {
    document.body.innerHTML = html;
    return document.body.querySelector('[data-focus]') as Element;
  }

  it('should own keys while the xterm input textarea has focus', () => {
    const el = mount(
      '<div class="terminal xterm"><textarea class="xterm-helper-textarea" data-focus></textarea></div>',
    );
    expect(focusOwnsKeys(el)).toBe(true);
  });

  it('should own keys while any element inside the terminal has focus', () => {
    const el = mount(
      '<div class="xterm"><div class="xterm-screen" tabindex="0" data-focus></div></div>',
    );
    expect(focusOwnsKeys(el)).toBe(true);
  });

  it('should own keys in text fields and contenteditable surfaces', () => {
    expect(focusOwnsKeys(mount('<input data-focus />'))).toBe(true);
    expect(focusOwnsKeys(mount('<textarea data-focus></textarea>'))).toBe(true);
    expect(focusOwnsKeys(mount('<div contenteditable="true"><p data-focus></p></div>'))).toBe(true);
  });

  it('should not own keys on the page body or a plain row', () => {
    expect(focusOwnsKeys(document.body)).toBe(false);
    expect(focusOwnsKeys(mount('<div role="button" data-focus></div>'))).toBe(false);
    expect(focusOwnsKeys(null)).toBe(false);
  });
});
