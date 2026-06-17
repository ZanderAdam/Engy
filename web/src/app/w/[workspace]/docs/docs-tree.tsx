'use client';

import { useCallback, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { TreeView, type TreeDataItem } from '@/components/tree-view';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiFile2Line,
  RiFileTextLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiImageLine,
} from '@remixicon/react';
import { fileKind } from '@/lib/file-types';

type FileEntry = { path: string; mtime: number };

interface DirNode {
  children: Map<string, DirNode>;
  files: { name: string; path: string; mtime: number }[];
}

function buildTrie(files: FileEntry[]): DirNode {
  const root: DirNode = { children: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    const fileName = parts.pop()!;
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [] });
      }
      node = node.children.get(segment)!;
    }
    node.files.push({ name: fileName, path: f.path, mtime: f.mtime });
  }
  return root;
}

function trieToTreeItems(
  node: DirNode,
  parentPath: string,
  sectionPrefix: string,
  onSelectFile: (fullPath: string) => void,
): TreeDataItem[] {
  const fileItems: TreeDataItem[] = [...node.files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => {
      const kind = fileKind(f.name);
      const icon = kind === 'image' ? RiImageLine : kind === 'binary' ? RiFile2Line : RiFileTextLine;
      return {
        id: `${sectionPrefix}/${f.path}`,
        name: f.name,
        icon,
        onClick: () => onSelectFile(`${sectionPrefix}/${f.path}`),
      };
    });

  const dirItems: TreeDataItem[] = [...node.children.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dirName, dirNode]) => {
      const dirPath = parentPath ? `${parentPath}/${dirName}` : dirName;
      return {
        id: `dir:${sectionPrefix}/${dirPath}`,
        name: dirName,
        icon: RiFolderLine,
        openIcon: RiFolderOpenLine,
        children: trieToTreeItems(dirNode, dirPath, sectionPrefix, onSelectFile),
      };
    });

  return [...dirItems, ...fileItems];
}

function useDocsSectionQuery(sectionDir: string, sectionPrefix: string) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.dir.listFiles.useQuery(
    { dirPath: sectionDir },
    { retry: false },
  );
  const writeMutation = trpc.dir.write.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath: sectionDir }),
  });

  const createFile = useCallback(
    (fileName: string, onCreated: (relPath: string) => void) => {
      writeMutation.mutate(
        { dirPath: sectionDir, filePath: fileName, content: '' },
        { onSuccess: () => onCreated(`${sectionPrefix}/${fileName}`) },
      );
    },
    [writeMutation, sectionDir, sectionPrefix],
  );

  return { data, isLoading, error, createFile };
}

function NewDocButton({
  sectionLabel,
  onCreateFile,
}: {
  sectionLabel: string;
  onCreateFile: (fileName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const finalName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    onCreateFile(finalName);
    setOpen(false);
    setName('');
  }

  return (
    <>
      <button
        type="button"
        title={`New document in ${sectionLabel}`}
        className="flex items-center justify-center size-5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <RiAddLine className="size-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>New Document in {sectionLabel}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="filename.md"
              className="h-8 text-sm"
            />
            <DialogFooter className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!name.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocsSectionPanel({
  rootDir,
  section,
  label,
  selectedFile,
  onSelectFile,
  defaultOpen,
}: {
  rootDir: string;
  section: 'system' | 'docs';
  label: string;
  selectedFile: string | null;
  onSelectFile: (relPath: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const sectionDir = `${rootDir}/${section}`;
  const { data, isLoading, error, createFile } = useDocsSectionQuery(sectionDir, section);

  const treeData: TreeDataItem[] = useMemo(() => {
    if (!data) return [];
    const root = buildTrie(data.files);
    return trieToTreeItems(root, '', section, onSelectFile);
  }, [data, section, onSelectFile]);

  const selectedId = useMemo(() => {
    if (!selectedFile?.startsWith(`${section}/`)) return undefined;
    return selectedFile;
  }, [selectedFile, section]);

  const handleCreate = useCallback(
    (fileName: string) => {
      createFile(fileName, onSelectFile);
    },
    [createFile, onSelectFile],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 group">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1 min-w-0 cursor-pointer">
          {open ? (
            <RiArrowDownSLine className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <RiArrowRightSLine className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </span>
        </CollapsibleTrigger>
        <NewDocButton sectionLabel={label} onCreateFile={handleCreate} />
      </div>

      <CollapsibleContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-1 py-4 px-3">
            <p className="text-xs text-destructive">Failed to load files</p>
            <p className="text-[10px] text-muted-foreground text-center">{sectionDir}</p>
          </div>
        ) : treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-4 px-3">
            <p className="text-xs text-muted-foreground">No files yet</p>
          </div>
        ) : (
          <div className="px-2 py-1">
            <TreeView
              data={treeData}
              initialSelectedItemId={selectedId}
              onSelectChange={(item) => {
                if (item && !item.children) onSelectFile(item.id);
              }}
              expandAll={false}
              defaultLeafIcon={RiFileTextLine}
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DocsSectionTree({
  rootDir,
  selectedFile,
  onSelectFile,
}: {
  rootDir: string;
  selectedFile: string | null;
  onSelectFile: (relPath: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
          Docs
        </h3>
      </div>
      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <DocsSectionPanel
          rootDir={rootDir}
          section="system"
          label="System Docs"
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          defaultOpen
        />
        <DocsSectionPanel
          rootDir={rootDir}
          section="docs"
          label="Shared Docs"
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          defaultOpen
        />
      </ScrollArea>
    </div>
  );
}
