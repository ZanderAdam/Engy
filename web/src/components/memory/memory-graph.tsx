'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RiSearchLine } from '@remixicon/react';
import {
  GROUP_BY_OPTIONS,
  buildLegend,
  cloneGraphData,
  colorForGroupValue,
  computeLinkCounts,
  groupValue,
  linkMatchesSearch,
  matchesSearch,
  nodeSize,
  type GraphGroupBy,
  type LinkEndpoint,
  type MemoryGraphData,
  type MemoryGraphNode,
} from './memory-graph-utils';

const EMPTY_GRAPH: MemoryGraphData = { nodes: [], links: [] };
// Transparent canvas over the panel's own bg-background — stays correct
// across the dark and cyberpunk theme flavors without resolving CSS vars at runtime.
const LINK_COLOR = 'rgba(255, 255, 255, 0.15)';

interface MemoryGraphProps {
  workspaceSlug: string;
  onSelect: (selection: { kind: 'permanent' | 'fleeting'; dbId: number }) => void;
}

export function MemoryGraph({ workspaceSlug, onSelect }: MemoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [groupBy, setGroupBy] = useState<GraphGroupBy>('subtype');
  const [search, setSearch] = useState('');

  const { data } = trpc.memory.graph.useQuery({ workspaceSlug });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Stable node identity across searches — filtering is done via the visibility
  // accessors below so the force layout never re-heats on a keystroke.
  const graphData = useMemo(() => cloneGraphData(data ?? EMPTY_GRAPH), [data]);
  const nodesById = useMemo(
    () => new Map(graphData.nodes.map((n) => [n.id, n])),
    [graphData.nodes],
  );
  const linkCounts = useMemo(() => computeLinkCounts(graphData.links), [graphData.links]);
  const visibleNodes = useMemo(
    () => graphData.nodes.filter((n) => matchesSearch(n, search)),
    [graphData.nodes, search],
  );
  const legend = useMemo(() => buildLegend(visibleNodes, groupBy), [visibleNodes, groupBy]);

  const nodeVisibility = useCallback((n: MemoryGraphNode) => matchesSearch(n, search), [search]);
  const linkVisibility = useCallback(
    (l: { source?: LinkEndpoint; target?: LinkEndpoint }) =>
      linkMatchesSearch(l.source, l.target, search, nodesById),
    [search, nodesById],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 h-full w-full overflow-hidden bg-background"
    >
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
        <div className="relative">
          <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-6 h-7 text-xs w-48"
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GraphGroupBy)}>
          <SelectTrigger size="sm" className="h-7 min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {legend.entries.length > 0 && (
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 bg-card/90 border border-border px-2 py-1.5 max-w-48">
          {legend.entries.map((entry) => (
            <div
              key={entry.value}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <span className="size-2 shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="truncate flex-1">{entry.value}</span>
              <span className="tabular-nums">{entry.count}</span>
            </div>
          ))}
          {legend.moreCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">+{legend.moreCount} more</span>
          )}
        </div>
      )}

      {size.width > 0 && size.height > 0 && (
        <ForceGraph3D<MemoryGraphNode>
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeLabel="title"
          nodeColor={(n) => colorForGroupValue(groupValue(n, groupBy))}
          nodeVal={(n) => nodeSize(n, linkCounts)}
          nodeVisibility={nodeVisibility}
          linkVisibility={linkVisibility}
          linkColor={() => LINK_COLOR}
          onNodeClick={(n) => onSelect({ kind: n.kind, dbId: n.dbId })}
        />
      )}
    </div>
  );
}
