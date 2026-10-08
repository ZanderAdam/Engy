// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { focusWhenFocusable } from './focus-when-focusable';

let frames: FrameRequestCallback[] = [];

function runFrame() {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(performance.now());
}

function terminalActions(focusable: () => boolean) {
  return { write: vi.fn(), kill: vi.fn(), focus: vi.fn(focusable) };
}

function appendInput(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  return input;
}

describe('focusWhenFocusable', () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('when the terminal can take focus', () => {
    it('should focus the terminal on the next frame', () => {
      const actions = terminalActions(() => true);

      focusWhenFocusable(() => actions);
      expect(actions.focus).not.toHaveBeenCalled();
      runFrame();

      expect(actions.focus).toHaveBeenCalledTimes(1);
      expect(frames).toHaveLength(0);
    });
  });

  describe('when the terminal is not focusable yet', () => {
    it('should retry on later frames until the terminal takes focus', () => {
      let ready = false;
      const actions = terminalActions(() => ready);

      focusWhenFocusable(() => actions);
      runFrame();
      runFrame();
      ready = true;
      runFrame();

      expect(actions.focus).toHaveBeenCalledTimes(3);
      expect(frames).toHaveLength(0);
    });
  });

  describe('when the user focuses another input after the request', () => {
    it('[FR-TERMINAL-960] should not take focus away from that input', () => {
      const actions = terminalActions(() => true);
      const renameInput = appendInput();

      focusWhenFocusable(() => actions);
      renameInput.focus();
      runFrame();

      expect(actions.focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(renameInput);
      expect(frames).toHaveLength(0);
    });
  });

  describe('when the request comes from an input that keeps focus', () => {
    it('[FR-TERMINAL-960] should still focus the terminal', () => {
      const actions = terminalActions(() => true);
      appendInput().focus();

      focusWhenFocusable(() => actions);
      runFrame();

      expect(actions.focus).toHaveBeenCalledTimes(1);
    });
  });

  describe('when focus moves to another terminal after the request', () => {
    it('[FR-TERMINAL-960] should still focus the requested terminal', () => {
      const actions = terminalActions(() => true);
      const otherTerminal = document.createElement('div');
      otherTerminal.className = 'xterm';
      const otherTerminalInput = document.createElement('textarea');
      otherTerminal.appendChild(otherTerminalInput);
      document.body.appendChild(otherTerminal);

      focusWhenFocusable(() => actions);
      otherTerminalInput.focus();
      runFrame();

      expect(actions.focus).toHaveBeenCalledTimes(1);
    });
  });
});
