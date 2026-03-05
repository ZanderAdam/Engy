"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RiFileTextLine,
  RiFolderLine,
} from "@remixicon/react";

interface ProjectTreeProps {
  workspaceSlug: string;
  projectSlug: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

function buildFileTree(files: string[]): TreeDataItem[] {
  const dirs = new Map<string, TreeDataItem[]>();
  const rootFiles: TreeDataItem[] = [];

  for (const f of files) {
    const parts = f.split("/");
    if (parts.length > 1) {
      const dirName = parts[0];
      if (!dirs.has(dirName)) dirs.set(dirName, []);
      dirs.get(dirName)!.push({
        id: f,
        name: parts.slice(1).join("/"),
        icon: RiFileTextLine,
      });
    } else {
      rootFiles.push({ id: f, name: f, icon: RiFileTextLine });
    }
  }

  const result: TreeDataItem[] = [...rootFiles];
  for (const [dirName, children] of dirs) {
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
  const { data: node, isLoading } = trpc.project.listFiles.useQuery({
    workspaceSlug,
    projectSlug,
  });

  const treeData: TreeDataItem[] = useMemo(() => {
    if (!node) return [];
    return buildFileTree(node.files);
  }, [node]);

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
      </div>
      <ScrollArea className="flex-1">
        {treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <p className="text-sm text-muted-foreground">No files yet</p>
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
