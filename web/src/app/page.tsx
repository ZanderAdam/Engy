"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import { OpenDirDialog } from "@/components/open-dir/open-dir-dialog";
import { useRecentDirs } from "@/hooks/use-recent-dirs";
import { RiFolderOpenLine } from "@remixicon/react";

export default function HomePage() {
  const { data: workspaces, isLoading, error } = trpc.workspace.list.useQuery();
  const [openDirDialogOpen, setOpenDirDialogOpen] = useState(false);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { dirs: recentDirs, removeDir } = useRecentDirs();
  const router = useRouter();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Workspaces</h1>
        <Button variant="outline" size="sm" onClick={() => setOpenDirDialogOpen(true)}>
          <RiFolderOpenLine className="mr-2 size-4" />
          Open Directory
        </Button>
      </div>

      <OpenDirDialog open={openDirDialogOpen} onOpenChange={setOpenDirDialogOpen} />

      {isLoading && (
        <p className="text-sm text-muted-foreground" aria-live="polite">Loading...</p>
      )}

      {error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm font-medium">Failed to load workspaces</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && workspaces?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <p className="text-sm text-muted-foreground">
              No workspaces yet. Create one to get started.
            </p>
            <CreateWorkspaceDialog />
          </CardContent>
        </Card>
      )}

      {workspaces && workspaces.length > 0 && (
        <div className="flex flex-col gap-3">
          {workspaces.map((ws) => (
            <Link key={ws.id} href={`/w/${ws.slug}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{ws.name}</CardTitle>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {ws.slug}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(ws.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
          <div className="mt-2">
            <CreateWorkspaceDialog />
          </div>
        </div>
      )}

      {mounted && recentDirs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent Directories</h2>
          <div className="flex flex-col gap-1">
            {recentDirs.map((dir) => (
              <div key={dir} className="flex items-center gap-2 group">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 truncate"
                  onClick={() => router.push(`/open?path=${encodeURIComponent(dir)}`)}
                >
                  <RiFolderOpenLine className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{dir}</span>
                </button>
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground px-1"
                  onClick={() => removeDir(dir)}
                  aria-label="Remove from recent"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
