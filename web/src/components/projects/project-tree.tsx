"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RiFileTextLine,
  RiFolderLine,
  RiSearchLine,
  RiSortAsc,
  RiSortDesc,
} from "@remixicon/react";

type FileEntry = { path: string; mtime: number };
type SortMode = "modified" | "name";
type SortDir = "asc" | "desc";

interface ProjectTreeProps {
  workspaceSlug: string;
  projectSlug: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

function buildFileTree(
  files: FileEntry[],
  sortMode: SortMode,
  sortDir: SortDir,
  filterText: string,
): TreeDataItem[] {
  const lowerFilter = filterText.toLowerCase();
  const filtered = lowerFilter
    ? files.filter((f) => f.path.toLowerCase().includes(lowerFilter))
    : files;

  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "modified") return (a.mtime - b.mtime) * dir;
    return a.path.localeCompare(b.path) * dir;
  });

  const dirs = new Map<string, { children: TreeDataItem[]; maxMtime: number }>();
  const rootFiles: TreeDataItem[] = [];

  for (const f of sorted) {
    const parts = f.path.split("/");
    if (parts.length > 1) {
      const dirName = parts[0];
      if (!dirs.has(dirName)) dirs.set(dirName, { children: [], maxMtime: 0 });
      const d = dirs.get(dirName)!;
      d.children.push({
        id: f.path,
        name: parts.slice(1).join("/"),
        icon: RiFileTextLine,
      });
      if (f.mtime > d.maxMtime) d.maxMtime = f.mtime;
    } else {
      rootFiles.push({ id: f.path, name: f.path, icon: RiFileTextLine });
    }
  }

  const dirEntries = [...dirs.entries()];
  if (sortMode === "modified") {
    dirEntries.sort((a, b) => (a[1].maxMtime - b[1].maxMtime) * dir);
  } else {
    dirEntries.sort((a, b) => a[0].localeCompare(b[0]) * dir);
  }

  const result: TreeDataItem[] = [...rootFiles];
  for (const [dirName, { children }] of dirEntries) {
    result.push({ id: dirName, name: dirName, icon: RiFolderLine, children });
  }
  return result;
}

export function ProjectTree({
  workspaceSlug,
  projectSlug,
  selectedFile,
  onSelectFile,
}: ProjectTreeProps) {
  const [sortMode, setSortMode] = useState<SortMode>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterText, setFilterText] = useState("");

  const { data: node, isLoading } = trpc.project.listFiles.useQuery({
    workspaceSlug,
    projectSlug,
  });

  const treeData: TreeDataItem[] = useMemo(() => {
    if (!node) return [];
    return buildFileTree(node.files, sortMode, sortDir, filterText);
  }, [node, sortMode, sortDir, filterText]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Files
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
      <ScrollArea className="flex-1">
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
