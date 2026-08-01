import { describe, it, expect } from 'vitest';
import {
  buildLegend,
  cloneGraphData,
  colorForGroupValue,
  computeLinkCounts,
  groupValue,
  linkMatchesSearch,
  matchesSearch,
  nodeSize,
  truncateLabel,
  type MemoryGraphData,
  type MemoryGraphNode,
} from './memory-graph-utils';

function node(overrides: Partial<MemoryGraphNode>): MemoryGraphNode {
  return {
    id: 'p:1',
    kind: 'permanent',
    dbId: 1,
    title: 'Untitled',
    subtype: null,
    type: null,
    tags: [],
    themes: [],
    repo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('memory-graph-utils', () => {
  describe('groupValue', () => {
    it('should return the scalar field for subtype/type/repo groupings', () => {
      const n = node({ subtype: 'decision', type: null, repo: 'engy' });
      expect(groupValue(n, 'subtype')).toBe('decision');
      expect(groupValue(n, 'repo')).toBe('engy');
    });

    it('should return the first element for array fields', () => {
      const n = node({ tags: ['auth', 'refactor'], themes: ['security', 'ux'] });
      expect(groupValue(n, 'tag')).toBe('auth');
      expect(groupValue(n, 'theme')).toBe('security');
    });

    it('should bucket empty or null fields under "none"', () => {
      const n = node({ subtype: null, tags: [], themes: [], repo: null });
      expect(groupValue(n, 'subtype')).toBe('none');
      expect(groupValue(n, 'tag')).toBe('none');
      expect(groupValue(n, 'theme')).toBe('none');
      expect(groupValue(n, 'repo')).toBe('none');
    });

    it('should return the node kind directly for the kind grouping', () => {
      expect(groupValue(node({ kind: 'fleeting' }), 'kind')).toBe('fleeting');
    });
  });

  describe('matchesSearch', () => {
    it('should match case-insensitive substrings in title, tags, and themes', () => {
      const n = node({ title: 'Auth Token Rotation', tags: ['security'], themes: ['gotcha'] });
      expect(matchesSearch(n, 'auth')).toBe(true);
      expect(matchesSearch(n, 'SECURITY')).toBe(true);
      expect(matchesSearch(n, 'gotcha')).toBe(true);
      expect(matchesSearch(n, 'unrelated')).toBe(false);
    });

    it('should match everything for an empty or whitespace-only query', () => {
      expect(matchesSearch(node({ title: 'Anything' }), '')).toBe(true);
      expect(matchesSearch(node({ title: 'Anything' }), '   ')).toBe(true);
    });
  });

  describe('truncateLabel', () => {
    it('should pass short titles through and ellipsize long ones', () => {
      expect(truncateLabel('Short title')).toBe('Short title');
      const long = 'A very long memory title that overflows the label';
      const truncated = truncateLabel(long);
      expect(truncated.length).toBeLessThanOrEqual(26);
      expect(truncated.endsWith('…')).toBe(true);
    });
  });

  describe('cloneGraphData', () => {
    it('should return cloned objects, never the original references', () => {
      const data: MemoryGraphData = {
        nodes: [node({ id: 'p:1' })],
        links: [{ source: 'p:1', target: 'p:1' }],
      };

      const cloned = cloneGraphData(data);

      expect(cloned.nodes[0]).not.toBe(data.nodes[0]);
      expect(cloned.nodes[0]).toEqual(data.nodes[0]);
      expect(cloned.links[0]).not.toBe(data.links[0]);
      expect(cloned.links[0]).toEqual(data.links[0]);
    });
  });

  describe('linkMatchesSearch', () => {
    const authFlow = node({ id: 'p:1', title: 'Auth flow' });
    const authTokens = node({ id: 'p:2', title: 'Auth tokens' });
    const unrelated = node({ id: 'p:3', title: 'Unrelated' });
    const nodesById = new Map([
      ['p:1', authFlow],
      ['p:2', authTokens],
      ['p:3', unrelated],
    ]);

    it('should be visible only when both endpoints match the search', () => {
      expect(linkMatchesSearch('p:1', 'p:2', 'auth', nodesById)).toBe(true);
      expect(linkMatchesSearch('p:1', 'p:3', 'auth', nodesById)).toBe(false);
      expect(linkMatchesSearch('p:1', 'p:2', '', nodesById)).toBe(true);
    });

    it('should resolve endpoints given as node objects (post-processing form)', () => {
      expect(linkMatchesSearch(authFlow, authTokens, 'auth', nodesById)).toBe(true);
      expect(linkMatchesSearch(authFlow, unrelated, 'auth', nodesById)).toBe(false);
    });

    it('should hide links with unresolvable or missing endpoints', () => {
      expect(linkMatchesSearch('p:404', 'p:1', '', nodesById)).toBe(false);
      expect(linkMatchesSearch(undefined, 'p:1', '', nodesById)).toBe(false);
    });
  });

  describe('colorForGroupValue', () => {
    it('should return a stable color for the same value across calls', () => {
      expect(colorForGroupValue('decision')).toBe(colorForGroupValue('decision'));
    });

    it('should return the same grey for the "none" bucket regardless of other values', () => {
      expect(colorForGroupValue('none')).toBe('hsl(0, 0%, 55%)');
    });

    it('should generally differentiate distinct values', () => {
      expect(colorForGroupValue('decision')).not.toBe(colorForGroupValue('pattern'));
    });
  });

  describe('buildLegend', () => {
    it('should sort by frequency and cap entries, reporting the remainder', () => {
      const nodes = [
        node({ subtype: 'decision' }),
        node({ subtype: 'decision' }),
        node({ subtype: 'pattern' }),
      ];

      const { entries, moreCount } = buildLegend(nodes, 'subtype', 1);

      expect(entries).toEqual([
        { value: 'decision', color: colorForGroupValue('decision'), count: 2 },
      ]);
      expect(moreCount).toBe(1);
    });
  });

  describe('computeLinkCounts', () => {
    it('should count each node appearance across source and target', () => {
      const counts = computeLinkCounts([
        { source: 'p:1', target: 'p:2' },
        { source: 'p:1', target: 'p:3' },
      ]);

      expect(counts.get('p:1')).toBe(2);
      expect(counts.get('p:2')).toBe(1);
      expect(counts.get('p:3')).toBe(1);
    });
  });

  describe('nodeSize', () => {
    it('should keep fleeting nodes at the smallest fixed size regardless of links', () => {
      const linkCounts = new Map([['f:1', 5]]);
      expect(nodeSize(node({ id: 'f:1', kind: 'fleeting' }), linkCounts)).toBe(1);
    });

    it('should grow permanent nodes modestly with their link count', () => {
      const linkCounts = new Map([
        ['p:1', 0],
        ['p:2', 4],
      ]);
      const small = nodeSize(node({ id: 'p:1', kind: 'permanent' }), linkCounts);
      const bigger = nodeSize(node({ id: 'p:2', kind: 'permanent' }), linkCounts);
      expect(bigger).toBeGreaterThan(small);
    });

    it('should cap the link-count contribution so highly-linked nodes do not dominate', () => {
      const linkCounts = new Map([
        ['p:1', 8],
        ['p:2', 80],
      ]);
      expect(nodeSize(node({ id: 'p:1' }), linkCounts)).toBe(
        nodeSize(node({ id: 'p:2' }), linkCounts),
      );
    });
  });
});
