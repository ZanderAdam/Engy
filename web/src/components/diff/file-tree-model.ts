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

function trieToTreeItems(
  node: TrieNode,
  parentPath: string,
  dirIdPrefix: string,
): TreeDataItem[] {
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
      id: `${dirIdPrefix}${DIR_ID_PREFIX}${compactedPath}`,
      name: compactedName,
      children: trieToTreeItems(current, compactedPath, dirIdPrefix),
    };
  });

  const fileItems: TreeDataItem[] = node.files.map((filePath) => ({
    id: filePath,
    name: filePath.split('/').pop() ?? filePath,
  }));

  return [...dirItems, ...fileItems];
}

/**
 * `dirIdPrefix` namespaces directory ids so trees rendered side by side (the
 * staged and unstaged lists) expand independently even where their paths
 * coincide. File ids are always the raw path — callers use them for selection.
 */
export function buildFileTree(filePaths: string[], dirIdPrefix = ''): TreeDataItem[] {
  return trieToTreeItems(buildTrie(filePaths), '', dirIdPrefix);
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
