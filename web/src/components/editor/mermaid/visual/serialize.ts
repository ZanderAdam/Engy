/**
 * Serialize a structural FlowModel back to mermaid flowchart source. The output
 * is normalized (one statement per line, two-space indent) rather than a
 * character-perfect reproduction of the input — the visual editor regenerates
 * code from the model, the same way mermaid.ai's "Auto-Update" does. Unparsed
 * `raw` statements are re-emitted verbatim so nothing is lost.
 */

import {
  type FlowModel,
  type FlowNode,
  type FlowEdge,
  SHAPE_DELIMITERS,
} from './flow-model';

const INDENT = '  ';

/** Wrap a label in quotes when it contains characters that would break syntax. */
function encodeLabel(label: string): string {
  if (/["[\](){}|<>]/.test(label)) {
    return `"${label.replace(/"/g, '&quot;')}"`;
  }
  return label;
}

function nodeDefinition(node: FlowNode): string {
  if (node.shape === 'rectangle' && node.label === node.id) {
    return node.id;
  }
  const { open, close } = SHAPE_DELIMITERS[node.shape];
  return `${node.id}${open}${encodeLabel(node.label)}${close}`;
}

function edgeConnector(edge: FlowEdge): string {
  const base = (() => {
    switch (edge.style) {
      case 'thick':
        return edge.open ? '===' : '==>';
      case 'dotted':
        return edge.open ? '-.-' : '-.->';
      default:
        return edge.open ? '---' : '-->';
    }
  })();
  return edge.label.trim() === '' ? base : `${base}|${encodeLabel(edge.label)}|`;
}

function edgeLine(edge: FlowEdge): string {
  return `${INDENT}${edge.source} ${edgeConnector(edge)} ${edge.target}`;
}

export function serializeFlowchart(model: FlowModel): string {
  const lines: string[] = [`${model.keyword} ${model.direction}`];

  const assigned = new Set<string>();
  for (const sg of model.subgraphs) {
    const header = sg.title === sg.id ? sg.id : `${sg.id} [${encodeLabel(sg.title)}]`;
    lines.push(`${INDENT}subgraph ${header}`);
    for (const nodeId of sg.nodeIds) {
      const node = model.nodes.find((n) => n.id === nodeId);
      if (node) {
        lines.push(`${INDENT}${INDENT}${nodeDefinition(node)}`);
        assigned.add(nodeId);
      }
    }
    lines.push(`${INDENT}end`);
  }

  for (const node of model.nodes) {
    if (!assigned.has(node.id)) {
      lines.push(`${INDENT}${nodeDefinition(node)}`);
    }
  }

  for (const edge of model.edges) {
    lines.push(edgeLine(edge));
  }

  for (const raw of model.raw) {
    lines.push(`${INDENT}${raw}`);
  }

  return lines.join('\n');
}
