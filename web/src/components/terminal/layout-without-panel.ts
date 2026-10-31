import type { SerializedDockview } from 'dockview';

interface GridNode {
  type: 'leaf' | 'branch';
  data: unknown;
  size?: number;
  visible?: boolean;
}

interface LeafData {
  id: string;
  views: string[];
  activeView?: string;
}

function pruneNode(node: GridNode, panelId: string, removedGroupIds: string[]): GridNode | null {
  if (node.type === 'branch') {
    const children = (node.data as GridNode[])
      .map((child) => pruneNode(child, panelId, removedGroupIds))
      .filter((child): child is GridNode => child !== null);
    return children.length === 0 ? null : { ...node, data: children };
  }
  const leaf = node.data as LeafData;
  const views = leaf.views.filter((id) => id !== panelId);
  if (views.length === 0) {
    removedGroupIds.push(leaf.id);
    return null;
  }
  const activeView = leaf.activeView === panelId ? views[0] : leaf.activeView;
  return { ...node, data: { ...leaf, views, activeView } };
}

function firstLeafId(node: GridNode): string | undefined {
  if (node.type === 'leaf') return (node.data as LeafData).id;
  for (const child of node.data as GridNode[]) {
    const id = firstLeafId(child);
    if (id) return id;
  }
  return undefined;
}

export function layoutWithoutPanel(
  layout: SerializedDockview,
  panelId: string,
): SerializedDockview | null {
  const removedGroupIds: string[] = [];
  const root = pruneNode(layout.grid.root as GridNode, panelId, removedGroupIds);
  if (!root) return null;
  const { [panelId]: _removed, ...panels } = layout.panels;
  const activeGroup =
    layout.activeGroup && removedGroupIds.includes(layout.activeGroup)
      ? firstLeafId(root)
      : layout.activeGroup;
  return {
    ...layout,
    grid: { ...layout.grid, root: root as SerializedDockview['grid']['root'] },
    panels,
    activeGroup,
  };
}
