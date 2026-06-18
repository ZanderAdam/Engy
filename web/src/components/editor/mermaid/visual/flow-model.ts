/**
 * Structural model of a mermaid flowchart, used to back the visual editor's
 * two-way sync. The model is intentionally position-free: mermaid lays the
 * diagram out on render, so we only track structure (nodes, edges, shapes,
 * labels, direction, subgraphs). Any statement the parser doesn't understand
 * is preserved verbatim as a `raw` line so round-tripping never drops user
 * content (classDef, style, click, comments, …).
 */

/** Node shapes we can both parse and serialize, keyed by a stable name. */
export type NodeShape =
  | 'rectangle'
  | 'rounded'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'rhombus'
  | 'hexagon'
  | 'parallelogram';

/** Opening/closing delimiters for each shape in mermaid flowchart syntax. */
export const SHAPE_DELIMITERS: Record<NodeShape, { open: string; close: string }> = {
  rectangle: { open: '[', close: ']' },
  rounded: { open: '(', close: ')' },
  stadium: { open: '([', close: '])' },
  subroutine: { open: '[[', close: ']]' },
  cylinder: { open: '[(', close: ')]' },
  circle: { open: '((', close: '))' },
  rhombus: { open: '{', close: '}' },
  hexagon: { open: '{{', close: '}}' },
  parallelogram: { open: '[/', close: '/]' },
};

/** Human-friendly labels for the shape palette / toolbar. */
export const SHAPE_LABELS: Record<NodeShape, string> = {
  rectangle: 'Rectangle',
  rounded: 'Rounded',
  stadium: 'Stadium',
  subroutine: 'Subroutine',
  cylinder: 'Database',
  circle: 'Circle',
  rhombus: 'Decision',
  hexagon: 'Hexagon',
  parallelogram: 'Parallelogram',
};

/** Ordered list of shapes longest-delimiter-first for greedy matching. */
export const SHAPES_BY_SPECIFICITY: NodeShape[] = (
  Object.keys(SHAPE_DELIMITERS) as NodeShape[]
).sort((a, b) => SHAPE_DELIMITERS[b].open.length - SHAPE_DELIMITERS[a].open.length);

/** Shapes in the order displayed in the palette and shape picker. */
export const PALETTE_SHAPES: NodeShape[] = [
  'rectangle',
  'rounded',
  'stadium',
  'circle',
  'rhombus',
  'hexagon',
  'cylinder',
  'subroutine',
  'parallelogram',
];

export type EdgeStyle = 'normal' | 'thick' | 'dotted';

export interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  style: EdgeStyle;
  /** True for link lines with no arrowhead (`---` rather than `-->`). */
  open: boolean;
}

export interface FlowSubgraph {
  id: string;
  title: string;
  /** Node ids contained in this subgraph. */
  nodeIds: string[];
}

export type FlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';

export interface FlowModel {
  /** `flowchart` (default) or `graph` — preserved so re-serialization matches. */
  keyword: 'flowchart' | 'graph';
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  subgraphs: FlowSubgraph[];
  /** Statements the parser couldn't interpret, re-emitted verbatim. */
  raw: string[];
}

export function emptyModel(direction: FlowDirection = 'TD'): FlowModel {
  return {
    keyword: 'flowchart',
    direction,
    nodes: [],
    edges: [],
    subgraphs: [],
    raw: [],
  };
}

/** Generate a node id not already present in the model (A, B, … Z, A1, B1, …). */
export function nextNodeId(model: FlowModel): string {
  const used = new Set(model.nodes.map((n) => n.id));
  for (let suffix = 0; suffix < 1000; suffix++) {
    for (let i = 0; i < 26; i++) {
      const id = String.fromCharCode(65 + i) + (suffix === 0 ? '' : String(suffix));
      if (!used.has(id)) return id;
    }
  }
  // Practically unreachable; fall back to a timestamp-free counter.
  return `n${used.size}`;
}

/** Generate an edge id unique within the model. */
export function nextEdgeId(model: FlowModel): string {
  const used = new Set(model.edges.map((e) => e.id));
  let i = 0;
  while (used.has(`e${i}`)) i++;
  return `e${i}`;
}
