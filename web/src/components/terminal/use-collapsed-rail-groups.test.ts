// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { setRailGroupCollapsed } from './use-collapsed-rail-groups';

const STORAGE_KEY = 'engy:terminal-rail-collapsed-groups:v1';

function stored(): unknown {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
}

describe('setRailGroupCollapsed', () => {
  beforeEach(() => {
    setRailGroupCollapsed('p:ws/a', false);
    setRailGroupCollapsed('p:ws/a|feat', false);
  });

  it('[FR-TERMINAL-980] should persist each collapsed group id', () => {
    setRailGroupCollapsed('p:ws/a', true);
    setRailGroupCollapsed('p:ws/a|feat', true);
    expect(stored()).toEqual(['p:ws/a', 'p:ws/a|feat']);
  });

  it('[FR-TERMINAL-980] should drop a group id when the group opens again', () => {
    setRailGroupCollapsed('p:ws/a', true);
    setRailGroupCollapsed('p:ws/a|feat', true);
    setRailGroupCollapsed('p:ws/a', false);
    expect(stored()).toEqual(['p:ws/a|feat']);
  });

  it('[FR-TERMINAL-980] should not duplicate an id collapsed twice', () => {
    setRailGroupCollapsed('p:ws/a', true);
    setRailGroupCollapsed('p:ws/a', true);
    expect(stored()).toEqual(['p:ws/a']);
  });
});
