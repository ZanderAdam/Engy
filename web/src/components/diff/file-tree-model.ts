import type { TreeDataItem } from '@/components/tree-view';

interface TrieNode {
  children: Map<string, TrieNode>;
  files: string[];
}

export const DIR_ID_PREFIX = 'dir:';

function buildTrie(filePaths: string[]): TrieNode {
  const root: TrieNode = { children: new Map(), files: [] };
  for (const filePath of [...filePaths].sort((a, b) => a.localeCompare(b))) {
    const parts = filePath.split('/');
    parts.pop();
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [] });
      }
      node = node.children.get(segment)!;
    }
    node.files.push(filePath);
  }
  return root;
}

function trieToTreeItems(node: TrieNode, parentPath: string, idPrefix: string): TreeDataItem[] {
  const dirEntries = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const dirItems: TreeDataItem[] = dirEntries.map(([dirName, dirNode]) => {
    let compactedName = dirName;
    let compactedPath = parentPath ? `${parentPath}/${dirName}` : dirName;
    let current = dirNode;

    // Collapse single-child chains (`web/src/components`) into one node so the
    // tree is no deeper than the meaningful branch points.
    while (current.children.size === 1 && current.files.length === 0) {
      const [childName, childNode] = current.children.entries().next().value!;
      compactedName = `${compactedName}/${childName}`;
      compactedPath = `${compactedPath}/${childName}`;
      current = childNode;
    }

    return {
      id: `${idPrefix}${DIR_ID_PREFIX}${compactedPath}`,
      name: compactedName,
      children: trieToTreeItems(current, compactedPath, idPrefix),
    };
  });

  const fileItems: TreeDataItem[] = node.files.map((filePath) => ({
    id: `${idPrefix}${filePath}`,
    name: filePath.split('/').pop() ?? filePath,
  }));

  return [...dirItems, ...fileItems];
}

/**
 * `idPrefix` namespaces every id so trees rendered side by side (the staged and
 * unstaged lists) expand and select independently even where their paths
 * coincide — the same path really can appear in both, as two different diffs.
 * Callers hand file ids straight back as the selection, so the prefix has to
 * match whatever they decode with.
 */
export function buildFileTree(filePaths: string[], idPrefix = ''): TreeDataItem[] {
  return trieToTreeItems(buildTrie(filePaths), '', idPrefix);
}

export function collectDirIds(items: TreeDataItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (!item.children) continue;
    ids.push(item.id);
    ids.push(...collectDirIds(item.children));
  }
  return ids;
}
