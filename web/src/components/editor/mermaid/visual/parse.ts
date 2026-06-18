/**
 * Pragmatic line-based parser for the common mermaid flowchart subset. It is
 * deliberately forgiving: anything it can't interpret is preserved verbatim in
 * `model.raw` so a parse → edit → serialize round-trip never silently drops the
 * user's content. Positions are not tracked — mermaid lays the diagram out on
 * render.
 */

import {
  type FlowModel,
  type FlowNode,
  type FlowEdge,
  type FlowSubgraph,
  type FlowDirection,
  type NodeShape,
  type EdgeStyle,
  SHAPES_BY_SPECIFICITY,
  SHAPE_DELIMITERS,
  emptyModel,
} from './flow-model';

const DIRECTIONS: FlowDirection[] = ['TB', 'TD', 'BT', 'LR', 'RL'];

/** Returns 'flowchart' when the source is a flowchart/graph diagram, else 'other'. */
export function detectDiagramType(code: string): 'flowchart' | 'other' {
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('%%')) continue;
    const keyword = line.split(/\s+/)[0]?.toLowerCase();
    return keyword === 'flowchart' || keyword === 'graph' ? 'flowchart' : 'other';
  }
  return 'other';
}

/** Connector with an optional pipe label, e.g. `-->`, `-.->|yes|`, `===`. */
const CONNECTOR_RE = /(-{2,}>|-{2,}|-\.+->|-\.+-|={2,}>|={2,})\s*(?:\|([^|]*)\|)?/g;

/** Convert inline-label edges (`A -- yes --> B`) to pipe form (`A -->|yes| B`). */
function normalizeInlineLabels(stmt: string): string {
  return stmt
    .replace(/--\s+([^|>-][^|]*?)\s+-->/g, '-->|$1|')
    .replace(/--\s+([^|>-][^|]*?)\s+---/g, '---|$1|')
    .replace(/-\.\s+([^|>][^|]*?)\s+\.->/g, '-.->|$1|')
    .replace(/-\.\s+([^|>][^|]*?)\s+\.-/g, '-.-|$1|')
    .replace(/==\s+([^|>=][^|]*?)\s+==>/g, '==>|$1|')
    .replace(/==\s+([^|>=][^|]*?)\s+===/g, '===|$1|');
}

function connectorStyle(conn: string): EdgeStyle {
  if (conn.includes('.')) return 'dotted';
  if (conn.includes('=')) return 'thick';
  return 'normal';
}

interface ParsedToken {
  id: string;
  label?: string;
  shape?: NodeShape;
}

/** Parse a node token like `A`, `A[Label]`, `B([Stadium])`, `C{{Hex}}`. */
function parseNodeToken(token: string): ParsedToken | null {
  const trimmed = token.trim();
  if (trimmed === '') return null;
  const idMatch = trimmed.match(/^([A-Za-z0-9_.-]+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const rest = trimmed.slice(id.length).trim();
  if (rest === '') return { id };

  for (const shape of SHAPES_BY_SPECIFICITY) {
    const { open, close } = SHAPE_DELIMITERS[shape];
    if (rest.startsWith(open) && rest.endsWith(close) && rest.length >= open.length + close.length) {
      const inner = rest.slice(open.length, rest.length - close.length);
      return { id, shape, label: unquoteLabel(inner) };
    }
  }
  return { id };
}

function unquoteLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/&quot;/g, '"').replace(/#quot;/g, '"');
  }
  return trimmed;
}

/** Split a node segment on `&` (mermaid's multi-node operator). */
function parseSegment(segment: string): ParsedToken[] {
  return segment
    .split('&')
    .map((part) => parseNodeToken(part))
    .filter((t): t is ParsedToken => t !== null);
}

class ModelBuilder {
  private readonly model: FlowModel;
  private readonly subgraphStack: FlowSubgraph[] = [];
  private edgeCounter = 0;

  constructor(keyword: 'flowchart' | 'graph', direction: FlowDirection) {
    this.model = { ...emptyModel(direction), keyword };
  }

  result(): FlowModel {
    return this.model;
  }

  private touchNode(token: ParsedToken): FlowNode {
    let node = this.model.nodes.find((n) => n.id === token.id);
    if (!node) {
      node = { id: token.id, label: token.label ?? token.id, shape: token.shape ?? 'rectangle' };
      this.model.nodes.push(node);
    } else {
      if (token.label !== undefined) node.label = token.label;
      if (token.shape !== undefined) node.shape = token.shape;
    }
    this.assignToSubgraph(node.id);
    return node;
  }

  private assignToSubgraph(nodeId: string): void {
    const current = this.subgraphStack[this.subgraphStack.length - 1];
    if (!current) return;
    const alreadyAssigned = this.model.subgraphs.some((sg) => sg.nodeIds.includes(nodeId));
    if (!alreadyAssigned) current.nodeIds.push(nodeId);
  }

  openSubgraph(rest: string): void {
    const bracket = rest.match(/^([A-Za-z0-9_.-]+)\s*\[(.*)\]$/);
    const sg: FlowSubgraph = bracket
      ? { id: bracket[1], title: unquoteLabel(bracket[2]), nodeIds: [] }
      : { id: rest.trim() || `sub${this.model.subgraphs.length}`, title: unquoteLabel(rest), nodeIds: [] };
    this.model.subgraphs.push(sg);
    this.subgraphStack.push(sg);
  }

  closeSubgraph(): void {
    this.subgraphStack.pop();
  }

  addRaw(line: string): void {
    this.model.raw.push(line);
  }

  /** Parse one statement line that may contain a chain of edges and/or node defs. */
  addStatement(line: string): void {
    const stmt = normalizeInlineLabels(line);

    const segments: string[] = [];
    const connectors: { conn: string; label: string }[] = [];
    let lastIndex = 0;
    // matchAll uses an internal cursor, so CONNECTOR_RE's lastIndex is never mutated.
    for (const match of stmt.matchAll(CONNECTOR_RE)) {
      segments.push(stmt.slice(lastIndex, match.index));
      connectors.push({ conn: match[1], label: match[2] ?? '' });
      lastIndex = (match.index ?? 0) + match[0].length;
    }
    segments.push(stmt.slice(lastIndex));

    if (connectors.length === 0) {
      // No edge — a bare node definition (or unparseable → raw).
      const tokens = parseSegment(stmt);
      if (tokens.length === 0) {
        this.addRaw(line);
        return;
      }
      tokens.forEach((t) => this.touchNode(t));
      return;
    }

    const groups = segments.map((seg) => parseSegment(seg));
    if (groups.some((g) => g.length === 0)) {
      this.addRaw(line);
      return;
    }
    groups.forEach((group) => group.forEach((t) => this.touchNode(t)));

    for (let i = 0; i < connectors.length; i++) {
      const { conn, label } = connectors[i];
      const sources = groups[i];
      const targets = groups[i + 1];
      const style = connectorStyle(conn);
      const open = !conn.endsWith('>');
      for (const s of sources) {
        for (const t of targets) {
          const edge: FlowEdge = {
            id: `e${this.edgeCounter++}`,
            source: s.id,
            target: t.id,
            label: unquoteLabel(label),
            style,
            open,
          };
          this.model.edges.push(edge);
        }
      }
    }
  }
}

/**
 * Parse mermaid flowchart source into a structural model, or return null when
 * the source is not a flowchart/graph diagram.
 */
export function parseFlowchart(code: string): FlowModel | null {
  if (detectDiagramType(code) !== 'flowchart') return null;

  const lines = code.split('\n');
  let builder: ModelBuilder | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!builder) {
      if (line === '' || line.startsWith('%%')) continue;
      const header = line.match(/^(flowchart|graph)\s+([A-Za-z]{2})\b/i);
      const keyword = (header?.[1]?.toLowerCase() as 'flowchart' | 'graph') ?? 'flowchart';
      const dir = header?.[2]?.toUpperCase() as FlowDirection | undefined;
      const direction = dir && DIRECTIONS.includes(dir) ? dir : 'TD';
      builder = new ModelBuilder(keyword, direction);
      continue;
    }

    if (line === '' || line.startsWith('%%')) {
      if (line.startsWith('%%')) builder.addRaw(line);
      continue;
    }

    const sgMatch = line.match(/^subgraph\s+(.*)$/i);
    if (sgMatch) {
      builder.openSubgraph(sgMatch[1].trim());
      continue;
    }
    if (/^end$/i.test(line)) {
      builder.closeSubgraph();
      continue;
    }

    // Statements that aren't edges/nodes (classDef, style, click, linkStyle, …).
    if (/^(classDef|class|style|linkStyle|click|direction)\b/i.test(line)) {
      builder.addRaw(line);
      continue;
    }

    builder.addStatement(line);
  }

  return builder ? builder.result() : null;
}
