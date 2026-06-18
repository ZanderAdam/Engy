'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { RiAddLine, RiSubtractLine, RiRefreshLine, RiFocus3Line } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MonacoCodeEditor } from '../../monaco-code-editor';
import { renderDiagram, type MermaidTheme } from '../render';
import { zoomToPoint } from '../zoom-pan-math';
import { parseFlowchart } from './parse';
import { serializeFlowchart } from './serialize';
import {
  addEdge,
  addNode,
  addConnectedNode,
  deleteNode,
  deleteEdge,
  duplicateNode,
  updateNodeLabel,
  updateNodeShape,
  updateEdgeLabel,
} from './model-ops';
import { type FlowModel, type NodeShape, PALETTE_SHAPES, SHAPE_LABELS } from './flow-model';
import { ShapeIcon } from './shape-icon';
import {
  collectNodeBoxes,
  nodeAtPoint,
  nodeIdFromElement,
  edgeLabelElements,
  edgePathElements,
  edgeEndpointsFromPath,
  type NodeBox,
} from './svg-nodes';
import { NodeToolbar } from './node-toolbar';
import { ShapePalette } from './shape-palette';

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.1;
const RENDER_DEBOUNCE_MS = 200;

const HOVER_PAD = 16;

type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null;
type Connecting = { sourceId: string; x: number; y: number } | null;
/** A connection dropped on empty canvas, awaiting a shape choice for the new node. */
type PendingNode = { sourceId: string; x: number; y: number } | null;

interface MermaidVisualEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  className?: string;
}

export function MermaidVisualEditor({ code, onCodeChange, className }: MermaidVisualEditorProps) {
  const { resolvedTheme } = useTheme();
  const theme: MermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default';

  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [boxes, setBoxes] = useState<NodeBox[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Connecting>(null);
  const [panning, setPanning] = useState(false);
  const [pendingNode, setPendingNode] = useState<PendingNode>(null);
  const [autoFocusLabel, setAutoFocusLabel] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const panRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const didFitRef = useRef(false);

  const model = useMemo(() => parseFlowchart(code), [code]);

  // Mirror state into refs so window/wheel listeners read fresh values.
  const codeRef = useRef(code);
  const boxesRef = useRef(boxes);
  const connectingRef = useRef(connecting);
  const selectionRef = useRef(selection);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);
  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);
  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  useEffect(() => {
    transformRef.current = { scale, tx, ty };
  }, [scale, tx, ty]);

  // Render the diagram (debounced) whenever code or theme changes.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const result = await renderDiagram(`visual-${theme}`, code, theme);
      if ('svg' in result) {
        setSvg(result.svg);
        setError(null);
      } else {
        setError(result.error);
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, theme]);

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const svgEl = svgHostRef.current?.querySelector('svg');
    if (!container || !svgEl) return;
    // Divide rendered size by current scale to get natural (unscaled) dimensions.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const sw = svgEl.getBoundingClientRect().width / transformRef.current.scale;
    const sh = svgEl.getBoundingClientRect().height / transformRef.current.scale;
    if (sw === 0 || sh === 0) return;
    const next = Math.min(cw / sw, ch / sh, 1);
    setScale(next);
    setTx((cw - sw * next) / 2);
    setTy((ch - sh * next) / 2);
  }, []);

  // After each render: recompute node geometry and auto-fit the first diagram.
  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgHostRef.current?.querySelector('svg');
    if (!container || !svgEl) return;
    if (!didFitRef.current && svg) {
      didFitRef.current = true;
      fitToView();
    }
    setBoxes(collectNodeBoxes(container, svgEl));
  }, [svg, scale, tx, ty, fitToView]);

  const mutate = useCallback(
    (fn: (m: FlowModel) => FlowModel) => {
      const current = parseFlowchart(codeRef.current);
      if (!current) return;
      onCodeChange(serializeFlowchart(fn(current)));
    },
    [onCodeChange],
  );

  const mutateAndSelectNode = useCallback(
    (fn: (m: FlowModel) => { model: FlowModel; nodeId: string }) => {
      const current = parseFlowchart(codeRef.current);
      if (!current) return;
      const { model: next, nodeId } = fn(current);
      setSelection({ type: 'node', id: nodeId });
      onCodeChange(serializeFlowchart(next));
    },
    [onCodeChange],
  );

  // Wheel-to-zoom toward the cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const { scale: s, tx: t, ty: u } = transformRef.current;
      const r = zoomToPoint(s, t, u, factor, e.clientX - rect.left, e.clientY - rect.top, MIN_SCALE, MAX_SCALE);
      setScale(r.scale);
      setTx(r.tx);
      setTy(r.ty);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Track the connection drag globally so it survives the pointer leaving a node.
  const isConnecting = connecting !== null;
  useEffect(() => {
    if (!isConnecting) return;
    const onMove = (e: PointerEvent) => {
      const origin = containerRef.current?.getBoundingClientRect();
      if (!origin) return;
      setConnecting((c) => (c ? { ...c, x: e.clientX - origin.left, y: e.clientY - origin.top } : c));
    };
    const onUp = (e: PointerEvent) => {
      const origin = containerRef.current?.getBoundingClientRect();
      const c = connectingRef.current;
      if (origin && c) {
        const x = e.clientX - origin.left;
        const y = e.clientY - origin.top;
        const target = nodeAtPoint(boxesRef.current, x, y);
        if (target && target.id !== c.sourceId) {
          mutate((m) => addEdge(m, c.sourceId, target.id));
        } else if (!target) {
          // Dropped on empty canvas: ask which shape the new node should be.
          setPendingNode({ sourceId: c.sourceId, x, y });
        }
      }
      setConnecting(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // Re-bind only when a connection drag starts or ends, not on every move.
  }, [isConnecting, mutate]);

  // Delete/Escape on the current selection (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sel = selectionRef.current;
      if (!sel) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.closest('.monaco-editor'))) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (sel.type === 'node') mutate((m) => deleteNode(m, sel.id));
        else mutate((m) => deleteEdge(m, sel.id));
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mutate]);

  const selectEdgeByEndpoints = (source: string, target: string): boolean => {
    const edge = model?.edges.find((e) => e.source === source && e.target === target);
    if (edge) {
      setSelection({ type: 'edge', id: edge.id });
      return true;
    }
    return false;
  };

  const selectEdgeFromElement = (svgEl: SVGElement, el: Element): boolean => {
    if (!model) return false;
    // Clicking the line itself: identify by the path's source/target id (robust).
    const path = el.closest('g.edgePaths > path, path.flowchart-link');
    if (path) {
      const ends = edgeEndpointsFromPath(path);
      if (ends && selectEdgeByEndpoints(ends.source, ends.target)) return true;
    }
    // Clicking the label: map its index to the matching path, then to the edge.
    const label = el.closest('g.edgeLabels > g.edgeLabel');
    if (label) {
      const labels = edgeLabelElements(svgEl);
      const paths = edgePathElements(svgEl);
      const index = labels.indexOf(label as SVGElement);
      const ends = index >= 0 && index < paths.length ? edgeEndpointsFromPath(paths[index]) : null;
      if (ends && selectEdgeByEndpoints(ends.source, ends.target)) return true;
    }
    return false;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const svgEl = svgHostRef.current?.querySelector('svg');
    setAutoFocusLabel(false);
    const nodeEl = target.closest('g.node');
    if (nodeEl) {
      const id = nodeIdFromElement(nodeEl);
      if (id) setSelection({ type: 'node', id });
      return;
    }
    if (svgEl && selectEdgeFromElement(svgEl, target)) return;

    // Empty canvas: dismiss any picker, deselect and begin panning.
    setPendingNode(null);
    setSelection(null);
    panRef.current = { active: true, x: e.clientX, y: e.clientY };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const nodeEl = target.closest('g.node');
    if (nodeEl) {
      const id = nodeIdFromElement(nodeEl);
      if (id) {
        setSelection({ type: 'node', id });
        setAutoFocusLabel(true);
      }
      return;
    }
    const svgEl = svgHostRef.current?.querySelector('svg');
    if (svgEl && selectEdgeFromElement(svgEl, target)) setAutoFocusLabel(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      panRef.current = { active: true, x: e.clientX, y: e.clientY };
      setTx((t) => t + dx);
      setTy((t) => t + dy);
      return;
    }
    if (!connecting) {
      // Hover by geometry (padded) so handles on the node border don't flicker.
      const origin = containerRef.current?.getBoundingClientRect();
      if (origin) {
        const hit = nodeAtPoint(boxes, e.clientX - origin.left, e.clientY - origin.top, HOVER_PAD);
        setHoveredId(hit ? hit.id : null);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    panRef.current.active = false;
    setPanning(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const startConnection = (sourceId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const origin = containerRef.current?.getBoundingClientRect();
    if (!origin) return;
    setConnecting({ sourceId, x: e.clientX - origin.left, y: e.clientY - origin.top });
  };

  const zoomCenter = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { scale: s, tx: t, ty: u } = transformRef.current;
    const r = zoomToPoint(s, t, u, factor, width / 2, height / 2, MIN_SCALE, MAX_SCALE);
    setScale(r.scale);
    setTx(r.tx);
    setTy(r.ty);
  };

  const selectedNode =
    selection?.type === 'node' ? model?.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedBox = selectedNode ? boxes.find((b) => b.id === selectedNode.id) : undefined;
  const selectedEdgeBoxes =
    selection?.type === 'edge' && model
      ? (() => {
          const edge = model.edges.find((ed) => ed.id === selection.id);
          if (!edge) return null;
          const s = boxes.find((b) => b.id === edge.source);
          const t = boxes.find((b) => b.id === edge.target);
          return s && t ? { s, t } : null;
        })()
      : null;
  const handleSourceId = selection?.type === 'node' ? selection.id : hoveredId;
  const handleBox = handleSourceId ? boxes.find((b) => b.id === handleSourceId) : undefined;
  const connectingBox = connecting ? boxes.find((b) => b.id === connecting.sourceId) : undefined;

  const handlePoints = handleBox
    ? [
        { key: 'top', x: handleBox.left + handleBox.width / 2, y: handleBox.top },
        { key: 'right', x: handleBox.left + handleBox.width, y: handleBox.top + handleBox.height / 2 },
        { key: 'bottom', x: handleBox.left + handleBox.width / 2, y: handleBox.top + handleBox.height },
        { key: 'left', x: handleBox.left, y: handleBox.top + handleBox.height / 2 },
      ]
    : [];

  const isFlowchart = model !== null;

  return (
    <div className={cn('flex h-full w-full min-h-0', className)}>
      <div className="w-2/5 min-w-[260px] max-w-[520px] border-r border-border min-h-0">
        <MonacoCodeEditor
          content={code}
          filePath="diagram.mermaid"
          repoRoot="mermaid"
          modelNamespace="mermaid-visual"
          minimap={false}
          onChange={onCodeChange}
        />
      </div>

      <div
        ref={containerRef}
        className={cn(
          'relative flex-1 min-h-0 overflow-hidden bg-muted/10 select-none',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => setHoveredId(null)}
      >
        {/* Transformed diagram layer */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
        >
          <div
            ref={svgHostRef}
            className="mermaid-visual-host [&_g.node]:cursor-pointer [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>

        {/* Overlay: selection, handles, temp connection (screen-space, untransformed) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          {selectedBox && (
            <rect
              x={selectedBox.left - 3}
              y={selectedBox.top - 3}
              width={selectedBox.width + 6}
              height={selectedBox.height + 6}
              className="fill-none stroke-primary"
              strokeWidth={1.5}
            />
          )}
          {selectedEdgeBoxes && (
            <line
              x1={selectedEdgeBoxes.s.cx}
              y1={selectedEdgeBoxes.s.cy}
              x2={selectedEdgeBoxes.t.cx}
              y2={selectedEdgeBoxes.t.cy}
              className="stroke-primary"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          )}
          {connecting && connectingBox && (
            <line
              x1={connectingBox.cx}
              y1={connectingBox.cy}
              x2={connecting.x}
              y2={connecting.y}
              className="stroke-primary"
              strokeWidth={2}
            />
          )}
        </svg>

        {/* Connect handles for the selected (or hovered) node */}
        {handlePoints.map((p) => (
          <div
            key={p.key}
            className="absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background cursor-crosshair hover:scale-125 transition-transform"
            style={{ left: p.x, top: p.y }}
            onPointerDown={(e) => handleSourceId && startConnection(handleSourceId, e)}
            title="Drag to connect"
          />
        ))}

        {selectedNode && selectedBox && (
          <NodeToolbar
            key={selectedNode.id}
            node={selectedNode}
            left={selectedBox.left + selectedBox.width / 2}
            top={selectedBox.top}
            autoFocus={autoFocusLabel}
            onRename={(label) => mutate((m) => updateNodeLabel(m, selectedNode.id, label))}
            onShapeChange={(shape: NodeShape) => mutate((m) => updateNodeShape(m, selectedNode.id, shape))}
            onDuplicate={() => mutateAndSelectNode((m) => duplicateNode(m, selectedNode.id))}
            onDelete={() => {
              mutate((m) => deleteNode(m, selectedNode.id));
              setSelection(null);
            }}
          />
        )}

        {/* Edge label editor — appears at the edge midpoint when an edge is selected */}
        {selection?.type === 'edge' && selectedEdgeBoxes && (
          <input
            key={selection.id}
            autoFocus={autoFocusLabel}
            defaultValue={model?.edges.find((e) => e.id === selection.id)?.label ?? ''}
            placeholder="Edge label"
            aria-label="Edge label"
            className="absolute z-20 h-6 w-28 -translate-x-1/2 -translate-y-1/2 bg-popover border border-border px-1.5 text-xs outline-none focus:border-ring shadow-md"
            style={{
              left: (selectedEdgeBoxes.s.cx + selectedEdgeBoxes.t.cx) / 2,
              top: (selectedEdgeBoxes.s.cy + selectedEdgeBoxes.t.cy) / 2,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const id = selection.id;
              const current = model?.edges.find((ed) => ed.id === id)?.label ?? '';
              if (e.target.value !== current) mutate((m) => updateEdgeLabel(m, id, e.target.value));
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
          />
        )}

        {/* Shape picker after dropping a connection on empty canvas */}
        {pendingNode && (
          <div
            className="absolute z-30 grid grid-cols-3 gap-0.5 bg-popover border border-border p-1 shadow-md -translate-x-1/2"
            style={{ left: pendingNode.x, top: pendingNode.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {PALETTE_SHAPES.map((shape) => (
              <button
                key={shape}
                type="button"
                title={SHAPE_LABELS[shape]}
                aria-label={`New ${SHAPE_LABELS[shape]}`}
                className="flex items-center justify-center p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                onClick={() => {
                  const sourceId = pendingNode.sourceId;
                  setPendingNode(null);
                  mutateAndSelectNode((m) => addConnectedNode(m, sourceId, shape));
                }}
              >
                <ShapeIcon shape={shape} />
              </button>
            ))}
          </div>
        )}

        {isFlowchart && (
          <ShapePalette onAddNode={(shape: NodeShape) => mutateAndSelectNode((m) => addNode(m, shape, 'New'))} />
        )}

        {/* Zoom controls */}
        <div
          className="absolute bottom-2 right-2 z-20 flex items-center gap-0.5 bg-popover/90 backdrop-blur-sm border border-border px-1 py-0.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => zoomCenter(1 / ZOOM_FACTOR)} aria-label="Zoom out">
            <RiSubtractLine className="size-3" />
          </Button>
          <span className="min-w-[3rem] text-center text-[10px] font-mono text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => zoomCenter(ZOOM_FACTOR)} aria-label="Zoom in">
            <RiAddLine className="size-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={fitToView} aria-label="Fit to view">
            <RiFocus3Line className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setScale(1);
              setTx(0);
              setTy(0);
            }}
            aria-label="Reset zoom"
          >
            <RiRefreshLine className="size-3" />
          </Button>
        </div>

        {error && (
          <div className="absolute left-2 bottom-2 z-20 max-w-[60%] bg-destructive/10 text-destructive text-xs font-mono px-2 py-1 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
