import { describe, it, expect } from 'vitest';
import {
  addNode,
  addEdge,
  addConnectedNode,
  deleteNode,
  deleteEdge,
  updateNodeLabel,
  updateNodeShape,
  duplicateNode,
} from './model-ops';
import { parseFlowchart } from './parse';
import type { FlowModel } from './flow-model';

function model(src: string): FlowModel {
  const m = parseFlowchart(src);
  expect(m).not.toBeNull();
  return m!;
}

describe('mermaid visual editor model-ops', () => {
  it('adds a node with a unique id', () => {
    const { model: next, nodeId } = addNode(model('flowchart TD\n A --> B'));
    expect(nodeId).toBe('C');
    expect(next.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
  });

  it('adds a connected node with an edge from the source', () => {
    const { model: next, nodeId } = addConnectedNode(model('flowchart TD\n A'), 'A', 'rounded');
    expect(next.nodes.find((n) => n.id === nodeId)!.shape).toBe('rounded');
    expect(next.edges).toContainEqual(expect.objectContaining({ source: 'A', target: nodeId }));
  });

  it('adds an edge but ignores self-loops and duplicates', () => {
    const base = model('flowchart TD\n A\n B');
    const once = addEdge(base, 'A', 'B');
    expect(once.edges).toHaveLength(1);
    expect(addEdge(once, 'A', 'B').edges).toHaveLength(1);
    expect(addEdge(once, 'A', 'A').edges).toHaveLength(1);
  });

  it('deletes a node along with its incident edges and membership', () => {
    const next = deleteNode(model('flowchart TD\n subgraph s\n A --> B\n end\n B --> C'), 'B');
    expect(next.nodes.map((n) => n.id)).toEqual(['A', 'C']);
    expect(next.edges).toHaveLength(0);
    expect(next.subgraphs[0].nodeIds).toEqual(['A']);
  });

  it('deletes an edge by id', () => {
    const base = model('flowchart TD\n A --> B');
    const next = deleteEdge(base, base.edges[0].id);
    expect(next.edges).toHaveLength(0);
    expect(next.nodes).toHaveLength(2);
  });

  it('updates node label and shape', () => {
    let next = updateNodeLabel(model('flowchart TD\n A --> B'), 'A', 'Start');
    next = updateNodeShape(next, 'A', 'cylinder');
    const a = next.nodes.find((n) => n.id === 'A')!;
    expect(a).toMatchObject({ label: 'Start', shape: 'cylinder' });
  });

  it('duplicates a node into the same subgraph', () => {
    const { model: next, nodeId } = duplicateNode(
      model('flowchart TD\n subgraph s\n A[Start] --> B\n end'),
      'A',
    );
    const dup = next.nodes.find((n) => n.id === nodeId)!;
    expect(dup).toMatchObject({ label: 'Start', shape: 'rectangle' });
    expect(next.subgraphs[0].nodeIds).toContain(nodeId);
  });

  it('does not mutate the input model', () => {
    const base = model('flowchart TD\n A --> B');
    const snapshot = JSON.stringify(base);
    addNode(base);
    deleteNode(base, 'A');
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
