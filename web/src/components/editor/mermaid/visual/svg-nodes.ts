/**
 * Helpers for mapping between mermaid's rendered flowchart SVG and our model.
 * Mermaid v11 renders each node as `<g class="node" id="flowchart-<id>-<n>">`
 * and edges in declaration order under `g.edgePaths`. We read geometry with
 * getBoundingClientRect so positions already include any CSS pan/zoom applied to
 * the SVG's wrapper — no manual matrix math needed.
 */

/**
 * Extract the model node id from a rendered `g.node` element. Mermaid v11 ids
 * look like `mermaid-<uuid>-<render>-flowchart-<id>-<counter>`, so the node id
 * is the segment between the `flowchart-` marker and the trailing counter.
 */
export function nodeIdFromElement(el: Element): string | null {
  const dataId = el.getAttribute('data-id');
  if (dataId) return dataId;
  const id = el.id;
  if (!id) return null;
  const marked = id.match(/flowchart-(.+?)-\d+$/);
  if (marked) return marked[1];
  const trailing = id.match(/^(.+)-\d+$/);
  return trailing ? trailing[1] : id;
}

export interface NodeBox {
  id: string;
  /** Container-relative pixel geometry (already reflects pan/zoom). */
  left: number;
  top: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/** Geometry of every rendered node, relative to `container`'s top-left. */
export function collectNodeBoxes(container: HTMLElement, svg: SVGElement): NodeBox[] {
  const origin = container.getBoundingClientRect();
  const boxes: NodeBox[] = [];
  for (const el of svg.querySelectorAll('g.node')) {
    const id = nodeIdFromElement(el);
    if (!id) continue;
    const r = el.getBoundingClientRect();
    const left = r.left - origin.left;
    const top = r.top - origin.top;
    boxes.push({
      id,
      left,
      top,
      width: r.width,
      height: r.height,
      cx: left + r.width / 2,
      cy: top + r.height / 2,
    });
  }
  return boxes;
}

/** The topmost node whose box contains the given container-relative point. */
export function nodeAtPoint(boxes: NodeBox[], x: number, y: number): NodeBox | undefined {
  // Iterate in reverse so later (visually on-top) nodes win ties.
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height) {
      return b;
    }
  }
  return undefined;
}

/** Edge paths in declaration order — index maps to model.edges[index]. */
export function edgePathElements(svg: SVGElement): SVGElement[] {
  const paths = svg.querySelectorAll<SVGElement>('g.edgePaths > path, path.flowchart-link');
  return [...paths];
}

/** Edge label groups in declaration order — index maps to model.edges[index]. */
export function edgeLabelElements(svg: SVGElement): SVGElement[] {
  const labels = svg.querySelectorAll<SVGElement>('g.edgeLabels .edgeLabel, .edgeLabel');
  return [...labels];
}
