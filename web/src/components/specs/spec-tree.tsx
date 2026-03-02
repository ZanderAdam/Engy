"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateSpecDialog } from "./create-spec-dialog";
import {
  RiFileTextLine,
  RiFileList2Line,
  RiEyeLine,
  RiFolderLine,
  RiAddLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";

interface SpecTreeProps {
  workspaceSlug: string;
  selectedSpec: string | null;
  onSelectSpec: (specSlug: string | null) => void;
  onSelectFile?: (specSlug: string, filePath: string) => void;
}

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  buildable: RiFileList2Line,
  vision: RiEyeLine,
};

function buildFileTree(specName: string, files: string[]): TreeDataItem[] {
  const dirs = new Map<string, TreeDataItem[]>();
  const rootFiles: TreeDataItem[] = [];

  for (const f of files) {
    const parts = f.split("/");
    if (parts.length > 1) {
      const dirName = parts[0];
      if (!dirs.has(dirName)) dirs.set(dirName, []);
      dirs.get(dirName)!.push({
        id: `${specName}/${f}`,
        name: parts.slice(1).join("/"),
        icon: RiFileTextLine,
      });
    } else {
      rootFiles.push({
        id: `${specName}/${f}`,
        name: f,
        icon: RiFileTextLine,
      });
    }
  }

  const result: TreeDataItem[] = [...rootFiles];
  for (const [dirName, children] of dirs) {
    result.push({
      id: `${specName}/${dirName}`,
      name: dirName,
      icon: RiFolderLine,
      children,
    });
  }
  return result;
}

export function SpecTree({
  workspaceSlug,
  selectedSpec,
  onSelectSpec,
  onSelectFile,
}: SpecTreeProps) {
  const { data: specs, isLoading } = trpc.spec.list.useQuery({
    workspaceSlug,
  });

  const treeData: TreeDataItem[] = useMemo(() => {
    if (!specs) return [];

    return specs.map((spec) => {
      const TypeIcon = typeIcons[spec.type ?? "buildable"] ?? RiFileTextLine;
      const children = buildFileTree(spec.name, spec.files);

      return {
        id: spec.name,
        name: spec.name,
        icon: TypeIcon,
        children,
        actions: spec.status ? (
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {spec.status}
          </Badge>
        ) : undefined,
      } satisfies TreeDataItem;
    });
  }, [specs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-sm text-muted-foreground">Loading specs...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Specs
        </h3>
        <CreateSpecDialog
          workspaceSlug={workspaceSlug}
          onCreated={(slug) => onSelectSpec(slug)}
        />
      </div>
      <ScrollArea className="flex-1">
        {treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <p className="text-sm text-muted-foreground">No specs yet</p>
            <p className="text-xs text-muted-foreground">
              Create your first spec to get started.
            </p>
          </div>
        ) : (
          <div className="p-2">
            <TreeView
              data={treeData}
              initialSelectedItemId={selectedSpec ?? undefined}
              onSelectChange={(item) => {
                if (!item) {
                  onSelectSpec(null);
                  return;
                }
                const specSlug = item.id.split("/")[0];
                onSelectSpec(specSlug);
                // If it's a file (has a / in the id), notify the parent
                if (item.id.includes("/") && onSelectFile) {
                  const filePath = item.id.substring(specSlug.length + 1);
                  onSelectFile(specSlug, filePath);
                }
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
