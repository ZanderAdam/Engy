import { describe, it, expect } from 'vitest';
import { nodeIdFromElement, nodeAtPoint, type NodeBox } from './svg-nodes';

/** Minimal stand-in for the parts of Element that nodeIdFromElement reads. */
function el(id: string, dataId: string | null = null): Element {
  return { id, getAttribute: (name: string) => (name === 'data-id' ? dataId : null) } as unknown as Element;
}

describe('mermaid visual editor svg-nodes', () => {
  describe('nodeIdFromElement', () => {
    it('extracts the id from mermaid v11 node element ids', () => {
      expect(nodeIdFromElement(el('mermaid-24817a03-0374-1-flowchart-A-0'))).toBe('A');
      expect(nodeIdFromElement(el('mermaid-uuid-1-flowchart-B-3'))).toBe('B');
      expect(nodeIdFromElement(el('mermaid-uuid-1-flowchart-Node1-9'))).toBe('Node1');
    });

    it('prefers an explicit data-id when present', () => {
      expect(nodeIdFromElement(el('flowchart-A-0', 'realId'))).toBe('realId');
    });

    it('falls back to a trailing-counter id, then the raw id', () => {
      expect(nodeIdFromElement(el('A-0'))).toBe('A');
      expect(nodeIdFromElement(el('plain'))).toBe('plain');
    });
  });

  describe('nodeAtPoint', () => {
    const boxes: NodeBox[] = [
      { id: 'A', left: 0, top: 0, width: 100, height: 40, cx: 50, cy: 20 },
      { id: 'B', left: 60, top: 20, width: 100, height: 40, cx: 110, cy: 40 },
    ];

    it('returns the topmost box containing the point', () => {
      expect(nodeAtPoint(boxes, 70, 30)?.id).toBe('B');
      expect(nodeAtPoint(boxes, 10, 10)?.id).toBe('A');
    });

    it('returns undefined when no box contains the point', () => {
      expect(nodeAtPoint(boxes, 500, 500)).toBeUndefined();
    });
  });
});
