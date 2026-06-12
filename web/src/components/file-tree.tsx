'use client';

import { useMemo, useState } from 'react';
import { TreeView, type TreeDataItem } from '@/components/tree-view';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileAddLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiFolderAddLine,
  RiLoopLeftLine,
  RiMore2Line,
  RiPencilLine,
  RiSearchLine,
  RiSortAsc,
  RiSortDesc,
} from '@remixicon/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isImagePath } from '@/lib/file-types';
import {
  type FileEntry,
  type SortMode,
  type SortDir,
  buildFileTree,
  parentPrefix,
  applyDefaultExtension,
} from '@/components/file-tree-helpers';

export type { FileEntry };

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
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onDirClick?: (dirPath: string) => void;
  searchFiles?: (query: string) => Promise<string[]>;
  defaultExtension?: string;
  canManageFile?: (relPath: string) => boolean;
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
  size = 'sm',
  defaultExtension,
}: {
  type: 'file' | 'dir';
  itemPath: string;
  itemName: string;
  rootAbsPath?: string;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDir?: (dirPath: string) => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  size?: 'sm' | 'xs';
  defaultExtension?: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'file' | 'folder'>('file');
  const [createName, setCreateName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');

  const hasCreateActions = type === 'dir' && (!!onCreateFile || !!onCreateDir);

  function handleCreateSubmit() {
    const trimmed = createName.trim();
    if (!trimmed) return;

    if (createMode === 'file') {
      onCreateFile?.(itemPath, applyDefaultExtension(trimmed, defaultExtension));
    } else {
      onCreateDir?.(itemPath ? `${itemPath}/${trimmed}` : trimmed);
    }

    setCreateOpen(false);
    setCreateName('');
  }

  function openCreate(m: 'file' | 'folder') {
    setCreateMode(m);
    setCreateName('');
    setCreateOpen(true);
  }

  function openRename() {
    setRenameName(itemName);
    setRenameOpen(true);
  }

  function handleRenameSubmit() {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === itemName) return;

    const finalName = type === 'file' ? applyDefaultExtension(trimmed, defaultExtension) : trimmed;
    onRename?.(finalName);
    setRenameOpen(false);
  }

  const filePlaceholder = `filename${defaultExtension ?? ''}`;
  const iconSize = size === 'xs' ? 'size-3' : 'size-3.5';
  const btnSize = size === 'xs' ? 'size-5' : 'size-6';

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
          {type === 'dir' && onCreateFile && (
            <DropdownMenuItem onClick={() => openCreate('file')}>
              <RiFileAddLine className="size-4" />
              New File
            </DropdownMenuItem>
          )}
          {type === 'dir' && onCreateDir && (
            <DropdownMenuItem onClick={() => openCreate('folder')}>
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
              Delete {type === 'file' ? 'File' : 'Folder'}
            </DropdownMenuItem>
          )}
          {itemPath !== '' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard
                    .writeText(itemPath)
                    .then(() => toast.success('Relative path copied'));
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
                      .then(() => toast.success('Full path copied'));
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
              <DialogTitle>{createMode === 'file' ? 'New File' : 'New Folder'}</DialogTitle>
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
                placeholder={createMode === 'folder' ? 'folder-name' : filePlaceholder}
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
              <DialogTitle>Rename {type === 'file' ? 'File' : 'Folder'}</DialogTitle>
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
              <AlertDialogTitle>Delete &ldquo;{itemName}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                {type === 'dir'
                  ? 'This will permanently delete this folder and all its contents.'
                  : 'This will permanently delete this file.'}{' '}
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
  label = 'Files',
  rootAbsPath,
  onCreateFile,
  onCreateDir,
  onDeleteFile,
  onDeleteDir,
  onRenameFile,
  onRenameDir,
  onRefresh,
  isRefreshing,
  onDirClick,
  searchFiles,
  defaultExtension,
  canManageFile,
}: FileTreeProps) {
  const [sortMode, setSortMode] = useState<SortMode>('modified');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterText, setFilterText] = useState('');
  const [searchResults, setSearchResults] = useState<string[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const hasCreateActions = !!onCreateFile || !!onCreateDir;

  async function handleFilterChange(query: string) {
    setFilterText(query);
    if (!searchFiles) return;
    if (!query) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchFiles(query);
      setSearchResults(results);
    } finally {
      setIsSearching(false);
    }
  }

  const dirActions = useMemo(
    () =>
      hasCreateActions || onDeleteDir || onRenameDir
        ? (dirPath: string) => (
            <ItemActions
              type="dir"
              itemPath={dirPath}
              itemName={dirPath.split('/').pop() ?? dirPath}
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
              defaultExtension={defaultExtension}
            />
          )
        : undefined,
    [hasCreateActions, rootAbsPath, onCreateFile, onCreateDir, onDeleteDir, onRenameDir, defaultExtension],
  );

  const fileActions = useMemo(
    () =>
      onDeleteFile || onRenameFile
        ? (filePath: string) => {
            const manageable = canManageFile ? canManageFile(filePath) : !isImagePath(filePath);
            return (
              <ItemActions
                type="file"
                itemPath={filePath}
                itemName={filePath.split('/').pop() ?? filePath}
                rootAbsPath={rootAbsPath}
                onDelete={onDeleteFile && manageable ? () => onDeleteFile(filePath) : undefined}
                onRename={
                  onRenameFile && manageable
                    ? (newName: string) =>
                        onRenameFile(filePath, `${parentPrefix(filePath)}${newName}`)
                    : undefined
                }
                size="xs"
                defaultExtension={defaultExtension}
              />
            );
          }
        : undefined,
    [rootAbsPath, onDeleteFile, onRenameFile, canManageFile, defaultExtension],
  );

  const treeData: TreeDataItem[] = useMemo(() => {
    const activeFiles: FileEntry[] =
      searchFiles && searchResults !== null
        ? searchResults.map((p) => ({ path: p, mtime: 0 }))
        : files;
    const activeDirs = searchFiles && searchResults !== null ? [] : dirs;
    const activeFilter = searchFiles ? '' : filterText;
    return buildFileTree(
      activeFiles,
      activeDirs,
      sortMode,
      sortDir,
      activeFilter,
      dirActions,
      fileActions,
      onDirClick,
    );
  }, [files, dirs, searchFiles, searchResults, filterText, sortMode, sortDir, dirActions, fileActions, onDirClick]);

  const searchPlaceholder = searchFiles ? 'Search files...' : 'Filter files...';
  const emptyMessage = filterText || (searchResults !== null && searchResults.length === 0)
    ? 'No matching files'
    : 'No files yet';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </h3>
        <div className="flex items-center gap-0.5">
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-6 w-6 p-0"
              title="Refresh"
            >
              <RiLoopLeftLine className={cn('size-3.5', isRefreshing && 'animate-spin')} />
            </Button>
          )}
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
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="flex items-center justify-center size-6 text-muted-foreground hover:text-foreground transition-colors"
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? (
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
              defaultExtension={defaultExtension}
            />
          )}
        </div>
      </div>
      <div className="relative px-3 py-1.5 border-b border-border">
        <RiSearchLine
          className={cn(
            'absolute left-5 top-1/2 -translate-y-1/2 size-3.5',
            isSearching ? 'animate-spin text-muted-foreground' : 'text-muted-foreground',
          )}
        />
        <Input
          value={filterText}
          onChange={(e) => {
            if (searchFiles) {
              void handleFilterChange(e.target.value);
            } else {
              setFilterText(e.target.value);
            }
          }}
          placeholder={searchPlaceholder}
          className="h-6 pl-6 text-xs border-0 bg-transparent focus-visible:ring-0"
        />
      </div>
      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block">
        {treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
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
