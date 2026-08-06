import { describe, it, expect } from 'vitest';
import { buildFileTree, collectDirIds, DIR_ID_PREFIX } from './file-tree-model';

describe('file tree model', () => {
  describe('buildFileTree', () => {
    it('returns a flat list of leaves for root-level files', () => {
      const items = buildFileTree(['b.txt', 'a.txt']);

      expect(items.map((i) => i.id)).toEqual(['a.txt', 'b.txt']);
      expect(items.every((i) => !i.children)).toBe(true);
    });

    it('groups files under directory nodes', () => {
      const items = buildFileTree(['src/a.ts', 'src/b.ts']);

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(`${DIR_ID_PREFIX}src`);
      expect(items[0].children?.map((c) => c.id)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('compacts single-child directory chains into one node', () => {
      const items = buildFileTree(['web/src/components/diff/a.tsx']);

      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('web/src/components/diff');
      expect(items[0].id).toBe(`${DIR_ID_PREFIX}web/src/components/diff`);
    });

    it('stops compacting at a branch point', () => {
      const items = buildFileTree(['web/src/a.ts', 'web/dist/b.ts']);

      expect(items[0].name).toBe('web');
      expect(items[0].children?.map((c) => c.name)).toEqual(['dist', 'src']);
    });

    it('stops compacting where a directory holds both files and subdirectories', () => {
      const items = buildFileTree(['web/index.ts', 'web/src/a.ts']);

      expect(items[0].name).toBe('web');
      expect(items[0].children?.map((c) => c.id)).toEqual([
        `${DIR_ID_PREFIX}web/src`,
        'web/index.ts',
      ]);
    });

    it('lists directories before files at the same level', () => {
      const items = buildFileTree(['z.txt', 'dir/a.txt']);

      expect(items.map((i) => i.id)).toEqual([`${DIR_ID_PREFIX}dir`, 'z.txt']);
    });

    it('returns an empty list for no paths', () => {
      expect(buildFileTree([])).toEqual([]);
    });

    it('namespaces both directory and file ids by prefix', () => {
      const items = buildFileTree(['src/a.ts'], 'staged:');

      expect(items[0].id).toBe(`staged:${DIR_ID_PREFIX}src`);
      expect(items[0].children?.[0].id).toBe('staged:src/a.ts');
    });

    it('[FR-GIT-260] gives the same path distinct ids under different prefixes', () => {
      const staged = buildFileTree(['src/a.ts'], 'staged:');
      const unstaged = buildFileTree(['src/a.ts'], 'unstaged:');

      expect(staged[0].id).not.toBe(unstaged[0].id);
      expect(staged[0].children?.[0].id).not.toBe(unstaged[0].children?.[0].id);
    });
  });

  describe('collectDirIds', () => {
    it('collects nested directory ids and skips leaves', () => {
      const items = buildFileTree(['web/src/a.ts', 'web/dist/b.ts', 'root.txt']);

      expect(collectDirIds(items).sort()).toEqual(
        [`${DIR_ID_PREFIX}web`, `${DIR_ID_PREFIX}web/dist`, `${DIR_ID_PREFIX}web/src`].sort(),
      );
    });

    it('returns an empty list when the tree is only files', () => {
      expect(collectDirIds(buildFileTree(['a.txt', 'b.txt']))).toEqual([]);
    });

    it('matches the ids buildFileTree produced, so expand-all opens every node', () => {
      const items = buildFileTree(['web/src/components/diff/a.tsx', 'web/src/lib/b.ts']);
      const ids = collectDirIds(items);

      const idsInTree: string[] = [];
      const walk = (nodes: typeof items) => {
        for (const node of nodes) {
          if (!node.children) continue;
          idsInTree.push(node.id);
          walk(node.children);
        }
      };
      walk(items);

      expect(ids.sort()).toEqual(idsInTree.sort());
    });
  });
});
