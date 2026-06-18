/**
 * Pure mutation helpers for the flowchart model. Each returns a new model so the
 * visual editor can drive React state predictably. They are the single source of
 * truth for "what a visual gesture does to the structure", which keeps the React
 * component thin and makes the behaviour unit-testable without a DOM.
 */

import {
  type FlowModel,
  type FlowNode,
  type FlowEdge,
  type NodeShape,
  type EdgeStyle,
  nextNodeId,
  nextEdgeId,
} from './flow-model';

function clone(model: FlowModel): FlowModel {
  return {
    keyword: model.keyword,
    direction: model.direction,
    nodes: model.nodes.map((n) => ({ ...n })),
    edges: model.edges.map((e) => ({ ...e })),
    subgraphs: model.subgraphs.map((s) => ({ ...s, nodeIds: [...s.nodeIds] })),
    raw: [...model.raw],
  };
}

export function addNode(
  model: FlowModel,
  shape: NodeShape = 'rectangle',
  label?: string,
): { model: FlowModel; nodeId: string } {
  const next = clone(model);
  const id = nextNodeId(next);
  const node: FlowNode = { id, label: label ?? id, shape };
  next.nodes.push(node);
  return { model: next, nodeId: id };
}

export function addConnectedNode(
  model: FlowModel,
  sourceId: string,
  shape: NodeShape = 'rectangle',
): { model: FlowModel; nodeId: string } {
  const { model: withNode, nodeId } = addNode(model, shape);
  return { model: addEdge(withNode, sourceId, nodeId), nodeId };
}

export function addEdge(
  model: FlowModel,
  source: string,
  target: string,
  style: EdgeStyle = 'normal',
): FlowModel {
  if (source === target) return model;
  const exists = model.edges.some((e) => e.source === source && e.target === target);
  if (exists) return model;
  const next = clone(model);
  const edge: FlowEdge = { id: nextEdgeId(next), source, target, label: '', style, open: false };
  next.edges.push(edge);
  return next;
}

export function deleteNode(model: FlowModel, id: string): FlowModel {
  const next = clone(model);
  next.nodes = next.nodes.filter((n) => n.id !== id);
  next.edges = next.edges.filter((e) => e.source !== id && e.target !== id);
  next.subgraphs = next.subgraphs.map((sg) => ({
    ...sg,
    nodeIds: sg.nodeIds.filter((nid) => nid !== id),
  }));
  return next;
}

export function deleteEdge(model: FlowModel, id: string): FlowModel {
  const next = clone(model);
  next.edges = next.edges.filter((e) => e.id !== id);
  return next;
}

export function updateNodeLabel(model: FlowModel, id: string, label: string): FlowModel {
  const next = clone(model);
  const node = next.nodes.find((n) => n.id === id);
  if (node) node.label = label;
  return next;
}

export function updateNodeShape(model: FlowModel, id: string, shape: NodeShape): FlowModel {
  const next = clone(model);
  const node = next.nodes.find((n) => n.id === id);
  if (node) node.shape = shape;
  return next;
}

export function updateEdgeLabel(model: FlowModel, id: string, label: string): FlowModel {
  const next = clone(model);
  const edge = next.edges.find((e) => e.id === id);
  if (edge) edge.label = label;
  return next;
}

export function duplicateNode(
  model: FlowModel,
  id: string,
): { model: FlowModel; nodeId: string } {
  const source = model.nodes.find((n) => n.id === id);
  if (!source) return { model, nodeId: id };
  const next = clone(model);
  const newId = nextNodeId(next);
  next.nodes.push({ id: newId, label: source.label, shape: source.shape });
  // Mirror subgraph membership so a duplicate stays in the same container.
  const sg = next.subgraphs.find((s) => s.nodeIds.includes(id));
  if (sg) sg.nodeIds.push(newId);
  return { model: next, nodeId: newId };
}
