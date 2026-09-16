'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { readOpenTerminals } from './terminal-session-store';

/** Ctrl+Alt, not Ctrl+digit or Alt+digit: browsers reserve both of those for
 * their own tabs and a page cannot override them. AltGr reports itself as
 * Ctrl+Alt on several layouts, so it must not count. */
export function isNumberHintChord(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return false;
  return !e.getModifierState?.('AltGraph');
}

/**
 * Read from `code` rather than `key`: Alt rewrites the character on several
 * layouts, so the digit only survives as the physical key.
 */
export function terminalNumberFromKey(e: KeyboardEvent): number | null {
  if (!isNumberHintChord(e)) return null;
  const match = /^Digit([1-9])$/.exec(e.code);
  return match ? Number(match[1]) : null;
}

let hintHeld = false;
const listeners = new Set<() => void>();

function setHintHeld(held: boolean): void {
  if (hintHeld === held) return;
  hintHeld = held;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the shortcut modifier is held, which is what reveals the
 * numbers for anyone not running voice. */
export function useNumberHint(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hintHeld,
    () => false,
  );
}

function onKeyDown(e: KeyboardEvent): void {
  setHintHeld(isNumberHintChord(e));
  const wanted = terminalNumberFromKey(e);
  if (wanted === null) return;
  const tab = readOpenTerminals()[wanted - 1];
  if (!tab) return;
  e.preventDefault();
  e.stopPropagation();
  window.dispatchEvent(new CustomEvent('terminal:focus', { detail: { sessionId: tab.sessionId } }));
}

function onKeyUp(e: KeyboardEvent): void {
  if (!isNumberHintChord(e)) setHintHeld(false);
}

function onBlur(): void {
  setHintHeld(false);
}

// Every workspace tab stays mounted, so without counting them one press would
// be handled once per open tab.
let mounts = 0;

/**
 * Ctrl+Alt reveals the terminal numbers, and Ctrl+Alt+N focuses that
 * terminal. Safe to call from every workspace tab: the listeners are attached
 * once for the app.
 */
export function useTerminalNumberShortcut(): void {
  useEffect(() => {
    mounts += 1;
    if (mounts === 1) {
      // Capture phase: a focused terminal handles keys first, so a bubbling
      // listener never sees the chord.
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', onBlur);
    }
    return () => {
      mounts -= 1;
      if (mounts > 0) return;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      setHintHeld(false);
    };
  }, []);
}
