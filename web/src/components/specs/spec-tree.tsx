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
} from "@remixicon/react";

interface SpecTreeProps {
  workspaceSlug: string;
  selectedSpec: string | null;
  onSelectSpec: (specSlug: string | null) => void;
}

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  buildable: RiFileList2Line,
  vision: RiEyeLine,
};

export function SpecTree({
  workspaceSlug,
  selectedSpec,
  onSelectSpec,
}: SpecTreeProps) {
  const { data: specs, isLoading } = trpc.spec.list.useQuery({
    workspaceSlug,
  });

  const treeData: TreeDataItem[] = useMemo(() => {
    if (!specs) return [];

    return specs.map((spec) => {
      const TypeIcon = typeIcons[spec.type] ?? RiFileTextLine;

      const children: TreeDataItem[] = [
        {
          id: `${spec.name}/spec.md`,
          name: "spec.md",
          icon: RiFileTextLine,
        },
        ...spec.contextFiles.map((f) => ({
          id: `${spec.name}/context/${f}`,
          name: f,
          icon: RiFileTextLine,
        })),
      ];

      return {
        id: spec.name,
        name: spec.name,
        icon: TypeIcon,
        children,
        actions: (
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {spec.status}
          </Badge>
        ),
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
                // If selecting a spec folder or its spec.md, select the spec
                const specSlug = item.id.split("/")[0];
                onSelectSpec(specSlug);
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
