// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerShortcut } from './dispatcher';

const cleanups: Array<() => void> = [];

function register(id: Parameters<typeof registerShortcut>[0], handler: () => void) {
  cleanups.push(registerShortcut(id, handler));
}

function pressOn(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function terminalInput(): HTMLTextAreaElement {
  const xterm = document.createElement('div');
  xterm.className = 'xterm';
  const input = document.createElement('textarea');
  xterm.append(input);
  document.body.append(xterm);
  input.focus();
  return input;
}

const CTRL_BACKQUOTE = { key: '`', code: 'Backquote', ctrlKey: true };

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe('shortcut dispatcher', () => {
  it('should run the handler and consume the key', () => {
    const handler = vi.fn();
    register('toggleTerminal', handler);

    const event = pressOn(document.body, CTRL_BACKQUOTE);

    expect(handler).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('[FR-TERMINAL-1100] should stop the key before a focused terminal sees it', () => {
    const handler = vi.fn();
    const terminalKeys = vi.fn();
    register('toggleTerminal', handler);
    const input = terminalInput();
    input.addEventListener('keydown', terminalKeys);

    pressOn(input, CTRL_BACKQUOTE);

    expect(handler).toHaveBeenCalledOnce();
    expect(terminalKeys).not.toHaveBeenCalled();
  });

  it('should leave the key alone when nothing is registered for it', () => {
    register('toggleBottomTerminal', vi.fn());

    expect(pressOn(document.body, CTRL_BACKQUOTE).defaultPrevented).toBe(false);
  });

  it('should fire once after a tab goes inactive and returns', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregister = registerShortcut('toggleTerminal', first);
    register('toggleTerminal', second);
    unregister();

    pressOn(document.body, CTRL_BACKQUOTE);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('should detach listeners with the last handler', () => {
    const handler = vi.fn();
    registerShortcut('toggleTerminal', handler)();

    pressOn(document.body, CTRL_BACKQUOTE);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should let a page keep ? when its listener runs first', () => {
    const handler = vi.fn();
    const pageOwnsKey = (e: Event) => e.preventDefault();
    register('help', handler);
    document.addEventListener('keydown', pageOwnsKey);

    pressOn(document.body, { key: '?', code: 'Slash', shiftKey: true });
    document.removeEventListener('keydown', pageOwnsKey);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should open help on ? when the page does not own it', () => {
    const handler = vi.fn();
    register('help', handler);

    pressOn(document.body, { key: '?', code: 'Slash', shiftKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });
});
