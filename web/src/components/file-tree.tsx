"use client";

import { useMemo, useState } from "react";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileAddLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiFolderAddLine,
  RiFolderLine,
  RiMore2Line,
  RiPencilLine,
  RiSearchLine,
  RiSortAsc,
  RiSortDesc,
} from "@remixicon/react";
import { toast } from "sonner";

type FileEntry = { path: string; mtime: number };
type SortMode = "modified" | "name";
type SortDir = "asc" | "desc";

interface FileTreeProps {
  files: FileEntry[];
  dirs?: string[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  label?: string;
  rootAbsPath?: string;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDir?: (dirPath: string) => void;
  onDeleteFile?: (filePath: string) => void;
  onDeleteDir?: (dirPath: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onRenameDir?: (oldPath: string, newPath: string) => void;
}

interface DirNode {
  children: Map<string, DirNode>;
  files: { name: string; path: string; mtime: number }[];
  maxMtime: number;
}

function buildTrie(files: FileEntry[], dirs: string[]): DirNode {
  const root: DirNode = { children: new Map(), files: [], maxMtime: 0 };

  for (const f of files) {
    const parts = f.path.split("/");
    const fileName = parts.pop()!;
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [], maxMtime: 0 });
      }
      node = node.children.get(segment)!;
      if (f.mtime > node.maxMtime) node.maxMtime = f.mtime;
    }
    node.files.push({ name: fileName, path: f.path, mtime: f.mtime });
    if (f.mtime > root.maxMtime) root.maxMtime = f.mtime;
  }

  // Ensure empty directories are represented in the trie
  for (const d of dirs) {
    const parts = d.split("/");
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [], maxMtime: 0 });
      }
      node = node.children.get(segment)!;
    }
  }

  return root;
}

function trieToTreeItems(
  node: DirNode,
  parentPath: string,
  sortMode: SortMode,
  sortDir: SortDir,
  dirActions?: (dirPath: string) => React.ReactNode,
  fileActions?: (filePath: string) => React.ReactNode,
): TreeDataItem[] {
  const sortMul = sortDir === "asc" ? 1 : -1;

  const sortedFiles = [...node.files].sort((a, b) => {
    if (sortMode === "modified") return (a.mtime - b.mtime) * sortMul;
    return a.name.localeCompare(b.name) * sortMul;
  });

  const fileItems: TreeDataItem[] = sortedFiles.map((f) => ({
    id: f.path,
    name: f.name,
    icon: RiFileTextLine,
    actions: fileActions?.(f.path),
  }));

  const dirEntries = [...node.children.entries()];
  if (sortMode === "modified") {
    dirEntries.sort((a, b) => (a[1].maxMtime - b[1].maxMtime) * sortMul);
  } else {
    dirEntries.sort((a, b) => a[0].localeCompare(b[0]) * sortMul);
  }

  const dirItems: TreeDataItem[] = dirEntries.map(([dirName, dirNode]) => {
    const dirPath = parentPath ? `${parentPath}/${dirName}` : dirName;
    return {
      id: `dir:${dirPath}`,
      name: dirName,
      icon: RiFolderLine,
      children: trieToTreeItems(dirNode, dirPath, sortMode, sortDir, dirActions, fileActions),
      actions: dirActions?.(dirPath),
    };
  });

  return [...dirItems, ...fileItems];
}

function parentPrefix(itemPath: string): string {
  const idx = itemPath.lastIndexOf("/");
  return idx >= 0 ? itemPath.substring(0, idx + 1) : "";
}

function buildFileTree(
  files: FileEntry[],
  dirs: string[],
  sortMode: SortMode,
  sortDir: SortDir,
  filterText: string,
  dirActions?: (dirPath: string) => React.ReactNode,
  fileActions?: (filePath: string) => React.ReactNode,
): TreeDataItem[] {
  const lowerFilter = filterText.toLowerCase();
  const filtered = lowerFilter
    ? files.filter((f) => f.path.toLowerCase().includes(lowerFilter))
    : files;

  const filteredDirs = lowerFilter
    ? dirs.filter((d) => d.toLowerCase().includes(lowerFilter))
    : dirs;

  const root = buildTrie(filtered, filteredDirs);
  return trieToTreeItems(root, "", sortMode, sortDir, dirActions, fileActions);
}

function ItemActions({
  type,
  itemPath,
  itemName,
  rootAbsPath,
  onCreateFile,
  onCreateDir,
  onDelete,
  onRename,
  size = "sm",
}: {
  type: "file" | "dir";
  itemPath: string;
  itemName: string;
  rootAbsPath?: string;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDir?: (dirPath: string) => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  size?: "sm" | "xs";
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"file" | "folder">("file");
  const [createName, setCreateName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");

  const hasCreateActions = type === "dir" && (!!onCreateFile || !!onCreateDir);

  function handleCreateSubmit() {
    const trimmed = createName.trim();
    if (!trimmed) return;

    if (createMode === "file") {
      const finalName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      onCreateFile?.(itemPath, finalName);
    } else {
      onCreateDir?.(itemPath ? `${itemPath}/${trimmed}` : trimmed);
    }

    setCreateOpen(false);
    setCreateName("");
  }

  function openCreate(m: "file" | "folder") {
    setCreateMode(m);
    setCreateName("");
    setCreateOpen(true);
  }

  function openRename() {
    setRenameName(itemName);
    setRenameOpen(true);
  }

  function handleRenameSubmit() {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === itemName) return;

    const finalName =
      type === "file" && !trimmed.endsWith(".md") ? `${trimmed}.md` : trimmed;
    onRename?.(finalName);
    setRenameOpen(false);
  }

  const iconSize = size === "xs" ? "size-3" : "size-3.5";
  const btnSize = size === "xs" ? "size-5" : "size-6";

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`flex items-center justify-center ${btnSize} text-muted-foreground hover:text-foreground transition-colors`}
            title="Actions"
            onClick={(e) => e.stopPropagation()}
          >
            {hasCreateActions && !onDelete && !onRename ? (
              <RiAddLine className={iconSize} />
            ) : (
              <RiMore2Line className={iconSize} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {type === "dir" && onCreateFile && (
            <DropdownMenuItem onClick={() => openCreate("file")}>
              <RiFileAddLine className="size-4" />
              New File
            </DropdownMenuItem>
          )}
          {type === "dir" && onCreateDir && (
            <DropdownMenuItem onClick={() => openCreate("folder")}>
              <RiFolderAddLine className="size-4" />
              New Folder
            </DropdownMenuItem>
          )}
          {hasCreateActions && (onRename || onDelete) && <DropdownMenuSeparator />}
          {onRename && (
            <DropdownMenuItem onClick={openRename}>
              <RiPencilLine className="size-4" />
              Rename
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <RiDeleteBinLine className="size-4" />
              Delete {type === "file" ? "File" : "Folder"}
            </DropdownMenuItem>
          )}
          {itemPath !== "" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard
                    .writeText(itemPath)
                    .then(() => toast.success("Relative path copied"));
                }}
              >
                <RiFileCopyLine className="size-4" />
                Copy relative path
              </DropdownMenuItem>
              {rootAbsPath && (
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard
                      .writeText(`${rootAbsPath}/${itemPath}`)
                      .then(() => toast.success("Full path copied"));
                  }}
                >
                  <RiFileCopyLine className="size-4" />
                  Copy full path
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasCreateActions && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-xs" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>{createMode === "file" ? "New File" : "New Folder"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateSubmit();
              }}
            >
              <Input
                autoFocus
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={createMode === "folder" ? "folder-name" : "filename.md"}
                className="h-8 text-sm"
              />
              <DialogFooter className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!createName.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {onRename && (
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent className="max-w-xs" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Rename {type === "file" ? "File" : "Folder"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRenameSubmit();
              }}
            >
              <Input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder={itemName}
                className="h-8 text-sm"
              />
              <DialogFooter className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRenameOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!renameName.trim() || renameName.trim() === itemName}
                >
                  Rename
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {onDelete && (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete &ldquo;{itemName}&rdquo;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {type === "dir"
                  ? "This will permanently delete this folder and all its contents."
                  : "This will permanently delete this file."}{" "}
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete();
                  setDeleteOpen(false);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

export function FileTree({
  files,
  dirs = [],
  selectedFile,
  onSelectFile,
  label = "Files",
  rootAbsPath,
  onCreateFile,
  onCreateDir,
  onDeleteFile,
  onDeleteDir,
  onRenameFile,
  onRenameDir,
}: FileTreeProps) {
  const [sortMode, setSortMode] = useState<SortMode>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterText, setFilterText] = useState("");

  const hasCreateActions = !!onCreateFile || !!onCreateDir;

  const dirActions = useMemo(
    () =>
      hasCreateActions || onDeleteDir || onRenameDir
        ? (dirPath: string) => (
            <ItemActions
              type="dir"
              itemPath={dirPath}
              itemName={dirPath.split("/").pop() ?? dirPath}
              rootAbsPath={rootAbsPath}
              onCreateFile={onCreateFile}
              onCreateDir={onCreateDir}
              onDelete={onDeleteDir ? () => onDeleteDir(dirPath) : undefined}
              onRename={
                onRenameDir
                  ? (newName: string) => onRenameDir(dirPath, `${parentPrefix(dirPath)}${newName}`)
                  : undefined
              }
              size="xs"
            />
          )
        : undefined,
    [hasCreateActions, rootAbsPath, onCreateFile, onCreateDir, onDeleteDir, onRenameDir],
  );

  const fileActions = useMemo(
    () =>
      onDeleteFile || onRenameFile
        ? (filePath: string) => (
            <ItemActions
              type="file"
              itemPath={filePath}
              itemName={filePath.split("/").pop() ?? filePath}
              rootAbsPath={rootAbsPath}
              onDelete={onDeleteFile ? () => onDeleteFile(filePath) : undefined}
              onRename={
                onRenameFile
                  ? (newName: string) => onRenameFile(filePath, `${parentPrefix(filePath)}${newName}`)
                  : undefined
              }
              size="xs"
            />
          )
        : undefined,
    [rootAbsPath, onDeleteFile, onRenameFile],
  );

  const treeData: TreeDataItem[] = useMemo(
    () => buildFileTree(files, dirs, sortMode, sortDir, filterText, dirActions, fileActions),
    [files, dirs, sortMode, sortDir, filterText, dirActions, fileActions],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </h3>
        <div className="flex items-center gap-0.5">
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger className="h-6 w-24 text-xs border-0 bg-transparent px-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modified">Modified</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex items-center justify-center size-6 text-muted-foreground hover:text-foreground transition-colors"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? (
              <RiSortAsc className="size-3.5" />
            ) : (
              <RiSortDesc className="size-3.5" />
            )}
          </button>
          {hasCreateActions && (
            <ItemActions
              type="dir"
              itemPath=""
              itemName=""
              onCreateFile={onCreateFile}
              onCreateDir={onCreateDir}
            />
          )}
        </div>
      </div>
      <div className="relative px-3 py-1.5 border-b border-border">
        <RiSearchLine className="absolute left-5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter files..."
          className="h-6 pl-6 text-xs border-0 bg-transparent focus-visible:ring-0"
        />
      </div>
      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block">
        {treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <p className="text-sm text-muted-foreground">
              {filterText ? "No matching files" : "No files yet"}
            </p>
          </div>
        ) : (
          <div className="p-2">
            <TreeView
              data={treeData}
              initialSelectedItemId={selectedFile ?? undefined}
              onSelectChange={(item) => {
                if (item && !item.children) onSelectFile(item.id);
              }}
              expandAll={false}
              defaultLeafIcon={RiFileTextLine}
            />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
