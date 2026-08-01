import type { RouterOutputs } from '@/lib/trpc';

export type MemoryGraphData = RouterOutputs['memory']['graph'];
export type MemoryGraphNode = MemoryGraphData['nodes'][number];
export type MemoryGraphLink = MemoryGraphData['links'][number];

export type GraphGroupBy = 'subtype' | 'type' | 'theme' | 'tag' | 'repo' | 'kind';

export const GROUP_BY_OPTIONS: { value: GraphGroupBy; label: string }[] = [
  { value: 'subtype', label: 'Subtype' },
  { value: 'type', label: 'Type' },
  { value: 'theme', label: 'Theme' },
  { value: 'tag', label: 'Tag' },
  { value: 'repo', label: 'Repo' },
  { value: 'kind', label: 'Kind' },
];

const NONE_BUCKET = 'none';

/** The value a node buckets under for the selected grouping dimension; array fields use their first element. */
export function groupValue(node: MemoryGraphNode, groupBy: GraphGroupBy): string {
  switch (groupBy) {
    case 'subtype':
      return node.subtype ?? NONE_BUCKET;
    case 'type':
      return node.type ?? NONE_BUCKET;
    case 'theme':
      return node.themes[0] ?? NONE_BUCKET;
    case 'tag':
      return node.tags[0] ?? NONE_BUCKET;
    case 'repo':
      return node.repo ?? NONE_BUCKET;
    case 'kind':
      return node.kind;
  }
}

export function matchesSearch(node: MemoryGraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    node.title.toLowerCase().includes(q) ||
    node.tags.some((t) => t.toLowerCase().includes(q)) ||
    node.themes.some((t) => t.toLowerCase().includes(q))
  );
}

// Always returns freshly-cloned nodes/links (never the query-cache objects) —
// 3d-force-graph mutates graphData in place (assigns x/y/z, replaces link
// source/target strings with node references), which would otherwise corrupt
// the shared react-query cache. Search filtering happens via visibility
// accessors, never by shrinking this array: a new node set makes the layout
// re-heat and re-scatter on every keystroke.
export function cloneGraphData(data: MemoryGraphData): MemoryGraphData {
  return {
    nodes: data.nodes.map((n) => ({ ...n })),
    links: data.links.map((l) => ({ ...l })),
  };
}

// After 3d-force-graph processes a link, source/target are node objects; before
// that they're still id strings. Resolve both forms against nodesById.
export type LinkEndpoint = string | number | MemoryGraphNode | undefined;

export function linkMatchesSearch(
  source: LinkEndpoint,
  target: LinkEndpoint,
  query: string,
  nodesById: Map<string, MemoryGraphNode>,
): boolean {
  const resolve = (endpoint: LinkEndpoint) =>
    typeof endpoint === 'object' ? endpoint : nodesById.get(String(endpoint));
  const sourceNode = resolve(source);
  const targetNode = resolve(target);
  if (!sourceNode || !targetNode) return false;
  return matchesSearch(sourceNode, query) && matchesSearch(targetNode, query);
}

// Deterministic hue from string content — the same value always yields the
// same color regardless of what else is in the graph or filtered out of it.
function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function colorForGroupValue(value: string): string {
  if (value === NONE_BUCKET) return 'hsl(0, 0%, 55%)';
  return `hsl(${hashHue(value)}, 65%, 58%)`;
}

export interface GraphLegendEntry {
  value: string;
  color: string;
  count: number;
}

export function buildLegend(
  nodes: MemoryGraphNode[],
  groupBy: GraphGroupBy,
  cap = 12,
): { entries: GraphLegendEntry[]; moreCount: number } {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const value = groupValue(node, groupBy);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const entries = sorted
    .slice(0, cap)
    .map(([value, count]) => ({ value, color: colorForGroupValue(value), count }));
  return { entries, moreCount: Math.max(0, sorted.length - cap) };
}

export function computeLinkCounts(links: MemoryGraphLink[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.source, (counts.get(link.source) ?? 0) + 1);
    counts.set(link.target, (counts.get(link.target) ?? 0) + 1);
  }
  return counts;
}

// Fleeting nodes stay smallest; permanent nodes grow modestly with their link count.
export function nodeSize(node: MemoryGraphNode, linkCounts: Map<string, number>): number {
  if (node.kind === 'fleeting') return 1;
  const links = linkCounts.get(node.id) ?? 0;
  return 2 + Math.min(links, 8) * 0.4;
}
