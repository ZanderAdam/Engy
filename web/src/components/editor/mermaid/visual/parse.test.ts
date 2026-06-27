import { describe, it, expect } from 'vitest';
import { parseFlowchart, detectDiagramType } from './parse';
import { serializeFlowchart } from './serialize';
import type { FlowModel } from './flow-model';

function reparse(code: string): FlowModel {
  const model = parseFlowchart(code);
  expect(model).not.toBeNull();
  return serializeRoundTrip(model!);
}

/** Serialize then parse again — the model should be stable across a round-trip. */
function serializeRoundTrip(model: FlowModel): FlowModel {
  const code = serializeFlowchart(model);
  const reparsed = parseFlowchart(code);
  expect(reparsed).not.toBeNull();
  return reparsed!;
}

describe('[FR-EDITOR-140] mermaid visual editor', () => {
  describe('[FR-EDITOR-140] detectDiagramType', () => {
    it('[FR-EDITOR-140] detects flowchart and graph keywords', () => {
      expect(detectDiagramType('flowchart TD\n A-->B')).toBe('flowchart');
      expect(detectDiagramType('graph LR\n A-->B')).toBe('flowchart');
    });

    it('[FR-EDITOR-140] treats other diagram types as other', () => {
      expect(detectDiagramType('sequenceDiagram\n A->>B: hi')).toBe('other');
      expect(detectDiagramType('classDiagram\n class A')).toBe('other');
      expect(detectDiagramType('')).toBe('other');
    });

    it('[FR-EDITOR-140] skips leading comments and blank lines', () => {
      expect(detectDiagramType('\n%% a comment\nflowchart TD\n A-->B')).toBe('flowchart');
    });
  });

  describe('[FR-EDITOR-140] parseFlowchart', () => {
    it('[FR-EDITOR-140] returns null for non-flowchart diagrams', () => {
      expect(parseFlowchart('sequenceDiagram\n A->>B: hi')).toBeNull();
    });

    it('[FR-EDITOR-140] parses direction and keyword', () => {
      const model = parseFlowchart('graph LR\n A --> B')!;
      expect(model.keyword).toBe('graph');
      expect(model.direction).toBe('LR');
    });

    it('[FR-EDITOR-140] defaults direction to TD when absent', () => {
      const model = parseFlowchart('flowchart\n A --> B')!;
      expect(model.direction).toBe('TD');
    });

    it('[FR-EDITOR-140] parses nodes, labels and edges', () => {
      const model = parseFlowchart('flowchart TD\n A[Start] --> B[End]')!;
      expect(model.nodes).toEqual([
        { id: 'A', label: 'Start', shape: 'rectangle' },
        { id: 'B', label: 'End', shape: 'rectangle' },
      ]);
      expect(model.edges).toHaveLength(1);
      expect(model.edges[0]).toMatchObject({ source: 'A', target: 'B', style: 'normal', open: false });
    });

    it('[FR-EDITOR-140] parses all supported node shapes', () => {
      const model = parseFlowchart(
        'flowchart TD\n A[r] --> B(round)\n C([stad]) --> D[[sub]]\n E[(db)] --> F((circ))\n G{dec} --> H{{hex}}\n I[/par/] --> A',
      )!;
      const shapeOf = (id: string) => model.nodes.find((n) => n.id === id)!.shape;
      expect(shapeOf('A')).toBe('rectangle');
      expect(shapeOf('B')).toBe('rounded');
      expect(shapeOf('C')).toBe('stadium');
      expect(shapeOf('D')).toBe('subroutine');
      expect(shapeOf('E')).toBe('cylinder');
      expect(shapeOf('F')).toBe('circle');
      expect(shapeOf('G')).toBe('rhombus');
      expect(shapeOf('H')).toBe('hexagon');
      expect(shapeOf('I')).toBe('parallelogram');
    });

    it('[FR-EDITOR-140] parses edge styles and open links', () => {
      const model = parseFlowchart('flowchart TD\n A --> B\n A --- B\n A -.-> B\n A ==> B')!;
      expect(model.edges.map((e) => ({ style: e.style, open: e.open }))).toEqual([
        { style: 'normal', open: false },
        { style: 'normal', open: true },
        { style: 'dotted', open: false },
        { style: 'thick', open: false },
      ]);
    });

    it('[FR-EDITOR-140] parses pipe edge labels', () => {
      const model = parseFlowchart('flowchart TD\n A -->|yes| B')!;
      expect(model.edges[0].label).toBe('yes');
    });

    it('[FR-EDITOR-140] parses inline edge labels', () => {
      const model = parseFlowchart('flowchart TD\n A -- maybe --> B')!;
      expect(model.edges[0].label).toBe('maybe');
      expect(model.edges[0].style).toBe('normal');
    });

    it('[FR-EDITOR-140] expands the & multi-node operator into separate edges', () => {
      const model = parseFlowchart('flowchart TD\n A & B --> C')!;
      expect(model.edges.map((e) => ({ s: e.source, t: e.target }))).toEqual([
        { s: 'A', t: 'C' },
        { s: 'B', t: 'C' },
      ]);
    });

    it('[FR-EDITOR-140] parses chained edges', () => {
      const model = parseFlowchart('flowchart TD\n A --> B --> C')!;
      expect(model.edges).toHaveLength(2);
      expect(model.edges[0]).toMatchObject({ source: 'A', target: 'B' });
      expect(model.edges[1]).toMatchObject({ source: 'B', target: 'C' });
    });

    it('[FR-EDITOR-140] parses subgraph membership', () => {
      const model = parseFlowchart(
        'flowchart TD\n subgraph plane [Data Plane]\n  A --> B\n end\n B --> C',
      )!;
      expect(model.subgraphs).toHaveLength(1);
      expect(model.subgraphs[0]).toMatchObject({ id: 'plane', title: 'Data Plane' });
      expect(model.subgraphs[0].nodeIds).toEqual(['A', 'B']);
      expect(model.nodes.map((n) => n.id)).toContain('C');
    });

    it('[FR-EDITOR-140] preserves unparsed statements as raw', () => {
      const model = parseFlowchart('flowchart TD\n A --> B\n classDef big fill:#f00\n class A big')!;
      expect(model.raw).toContain('classDef big fill:#f00');
      expect(model.raw).toContain('class A big');
    });

    it('[FR-EDITOR-140] reuses a node defined inline then referenced bare', () => {
      const model = parseFlowchart('flowchart TD\n A[Start] --> B\n B --> A')!;
      expect(model.nodes.find((n) => n.id === 'A')!.label).toBe('Start');
      expect(model.nodes).toHaveLength(2);
    });
  });

  describe('[FR-EDITOR-140] serializeFlowchart', () => {
    it('[FR-EDITOR-140] emits header, node defs and edges', () => {
      const model = parseFlowchart('flowchart LR\n A[Start] --> B(End)')!;
      const code = serializeFlowchart(model);
      expect(code).toContain('flowchart LR');
      expect(code).toContain('A[Start]');
      expect(code).toContain('B(End)');
      expect(code).toContain('A --> B');
    });

    it('[FR-EDITOR-140] uses shorthand for default rectangles labelled by id', () => {
      const model = parseFlowchart('flowchart TD\n A --> B')!;
      const code = serializeFlowchart(model);
      expect(code).toMatch(/^ {2}A$/m);
    });

    it('[FR-EDITOR-140] quotes labels containing reserved characters', () => {
      const model = parseFlowchart('flowchart TD\n A["a (b)"] --> B')!;
      const code = serializeFlowchart(model);
      expect(code).toContain('A["a (b)"]');
    });

    it('[FR-EDITOR-140] round-trips a label containing bracket characters', () => {
      const model = parseFlowchart('flowchart TD\n A["a [b]"] --> B')!;
      expect(model.nodes[0].label).toBe('a [b]');
      const reparsed = parseFlowchart(serializeFlowchart(model))!;
      expect(reparsed.nodes[0].label).toBe('a [b]');
    });

    it('[FR-EDITOR-140] round-trips structure (nodes, edges, shapes, labels, subgraphs)', () => {
      const source = [
        'flowchart TD',
        '  subgraph plane [Data Plane]',
        '    A[Extractor] --> B[(S3)]',
        '  end',
        '  B ==>|sync| C{Decision}',
        '  C -.-> D((Done))',
        '  classDef hot fill:#f00',
      ].join('\n');
      const first = parseFlowchart(source)!;
      const second = reparse(source);
      expect(second.nodes).toEqual(first.nodes);
      expect(second.edges.map((e) => ({ s: e.source, t: e.target, st: e.style, o: e.open, l: e.label }))).toEqual(
        first.edges.map((e) => ({ s: e.source, t: e.target, st: e.style, o: e.open, l: e.label })),
      );
      expect(second.subgraphs).toEqual(first.subgraphs);
      expect(second.raw).toEqual(first.raw);
    });
  });
});
