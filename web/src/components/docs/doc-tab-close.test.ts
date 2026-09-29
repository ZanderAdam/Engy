import { describe, it, expect } from 'vitest';
import { activeLast, panelsToClose } from './doc-tab-close';

const panels = [{ id: 'a.md' }, { id: 'b.md' }, { id: 'c.md' }];

describe('doc-tab-close', () => {
  describe('panelsToClose', () => {
    it('[FR-EDITOR-190] should return every panel except the anchor for close others', () => {
      expect(panelsToClose(panels, 'b.md', 'others').map((p) => p.id)).toEqual(['a.md', 'c.md']);
    });

    it('[FR-EDITOR-190] should return the panels after the anchor for close to the right', () => {
      expect(panelsToClose(panels, 'a.md', 'right').map((p) => p.id)).toEqual(['b.md', 'c.md']);
    });

    it('[FR-EDITOR-190] should return nothing to the right of the last panel', () => {
      expect(panelsToClose(panels, 'c.md', 'right')).toEqual([]);
    });

    it('[FR-EDITOR-190] should return nothing for an unknown anchor', () => {
      expect(panelsToClose(panels, 'x.md', 'right')).toEqual([]);
      expect(panelsToClose(panels, 'x.md', 'others')).toEqual([]);
    });
  });

  describe('activeLast', () => {
    it('[FR-EDITOR-190] should order the active panel last so close all activates no neighbour', () => {
      expect(activeLast(panels, 'a.md').map((p) => p.id)).toEqual(['b.md', 'c.md', 'a.md']);
    });

    it('[FR-EDITOR-190] should keep the order when no panel is active', () => {
      expect(activeLast(panels, undefined).map((p) => p.id)).toEqual(['a.md', 'b.md', 'c.md']);
    });
  });
});
