import { describe, it, expect } from 'vitest';
import type { SerializedDockview } from 'dockview';
import { layoutWithoutPanel } from './layout-without-panel';

function layoutOf(groups: Array<{ id: string; views: string[]; activeView?: string }>) {
  return {
    grid: {
      width: 100,
      height: 100,
      orientation: 'HORIZONTAL',
      root: {
        type: 'branch',
        size: 100,
        data: groups.map((g) => ({ type: 'leaf', size: 50, data: g })),
      },
    },
    panels: Object.fromEntries(
      groups.flatMap((g) => g.views).map((id) => [id, { id, contentComponent: 'terminal' }]),
    ),
    activeGroup: groups[0].id,
  } as unknown as SerializedDockview;
}

describe('layoutWithoutPanel', () => {
  it('[FR-TERMINAL-1130] should drop the panel from its group and from the panel table', () => {
    const result = layoutWithoutPanel(
      layoutOf([{ id: 'g1', views: ['a', 'pin', 'b'], activeView: 'pin' }]),
      'pin',
    )!;
    const leaf = (result.grid.root.data as Array<{ data: { views: string[]; activeView: string } }>)[0]
      .data;
    expect(leaf.views).toEqual(['a', 'b']);
    expect(leaf.activeView).toBe('a');
    expect(Object.keys(result.panels)).toEqual(['a', 'b']);
  });

  it('[FR-TERMINAL-1130] should remove a group that held only the panel', () => {
    const result = layoutWithoutPanel(
      layoutOf([
        { id: 'g1', views: ['a'] },
        { id: 'g2', views: ['pin'] },
      ]),
      'pin',
    )!;
    expect(result.grid.root.data).toHaveLength(1);
  });

  it('[FR-TERMINAL-1130] should move the active group to the first remaining group when its group is removed', () => {
    const layout = layoutOf([
      { id: 'g1', views: ['pin'] },
      { id: 'g2', views: ['a'] },
    ]);
    expect(layoutWithoutPanel(layout, 'pin')!.activeGroup).toBe('g2');
  });

  it('[FR-TERMINAL-1130] should return null when nothing else is left', () => {
    expect(layoutWithoutPanel(layoutOf([{ id: 'g1', views: ['pin'] }]), 'pin')).toBeNull();
  });

  it('[FR-TERMINAL-1130] should not change the input layout', () => {
    const layout = layoutOf([{ id: 'g1', views: ['a', 'pin'] }]);
    const before = JSON.stringify(layout);
    layoutWithoutPanel(layout, 'pin');
    expect(JSON.stringify(layout)).toBe(before);
  });
});
