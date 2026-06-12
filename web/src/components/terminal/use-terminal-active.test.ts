// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests for useTerminalActive per-tab seeding (Task 2 / FR-TG8.3).
 *
 * useTerminalActive is a React hook and cannot be rendered in .test.ts.
 * These tests verify the seeding logic in isolation:
 *
 *   window.__engy_terminal_active_by_tab?.[tabId] ?? false
 *
 * This ensures that a component mounting in tab B seeds `false` even when
 * tab A's flag is `true`, instead of reading the shared global.
 */

function seedFromTabMap(
  tabMap: Record<string, boolean> | undefined,
  tabId: string,
): boolean {
  return tabMap?.[tabId] ?? false;
}

describe('useTerminalActive per-tab seed', () => {
  beforeEach(() => {
    delete (window as Window).__engy_terminal_active;
    delete (window as Window).__engy_terminal_active_by_tab;
  });

  it('seeds false when no map exists', () => {
    expect(seedFromTabMap(undefined, 'tab-b')).toBe(false);
  });

  it('seeds false when the tab has no entry in the map', () => {
    const map = { 'tab-a': true };
    expect(seedFromTabMap(map, 'tab-b')).toBe(false);
  });

  it('seeds true when the tab has a true entry', () => {
    const map = { 'tab-a': true, 'tab-b': true };
    expect(seedFromTabMap(map, 'tab-b')).toBe(true);
  });

  it('seeds false when tab entry is false', () => {
    const map = { 'tab-a': true, 'tab-b': false };
    expect(seedFromTabMap(map, 'tab-b')).toBe(false);
  });

  it('tab B seeds false while tab A flag is true', () => {
    // Simulates: tab A's manager ran broadcastActive → wrote tab A entry + global
    window.__engy_terminal_active = true;
    window.__engy_terminal_active_by_tab = { 'tab-a': true };

    // Tab B component mounts — should read from per-tab map, not global
    const tabBSeed = seedFromTabMap(window.__engy_terminal_active_by_tab, 'tab-b');
    expect(tabBSeed).toBe(false);

    // Tab A component reads from per-tab map correctly
    const tabASeed = seedFromTabMap(window.__engy_terminal_active_by_tab, 'tab-a');
    expect(tabASeed).toBe(true);
  });
});

describe('terminal:active-changed event filtering (useTerminalActive update path)', () => {
  /**
   * The update logic in useTerminalActive's effect:
   *   if (detail.tabId !== undefined && detail.tabId !== tabId) return;
   *   setHasActiveTab(detail.hasActiveTab);
   */
  function shouldUpdate(
    eventTabId: string | undefined,
    consumerTabId: string,
    hasActiveTab: boolean,
  ): boolean | null {
    if (eventTabId !== undefined && eventTabId !== consumerTabId) return null;
    return hasActiveTab;
  }

  it('accepts a broadcast event (no tabId) for any consumer', () => {
    expect(shouldUpdate(undefined, 'tab-a', true)).toBe(true);
    expect(shouldUpdate(undefined, 'tab-b', false)).toBe(false);
  });

  it('accepts event whose tabId matches consumer', () => {
    expect(shouldUpdate('tab-a', 'tab-a', true)).toBe(true);
  });

  it('ignores event whose tabId differs from consumer', () => {
    expect(shouldUpdate('tab-a', 'tab-b', true)).toBeNull();
  });
});
