"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspace: string }>();
  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: params.workspace },
  );

  if (!workspace) return null;

  const repos = workspace.repos ?? [];

  return (
    <div className="flex flex-col gap-6 py-6">
      <div>
        <h2 className="text-lg font-semibold">{workspace.name}</h2>
        <Badge variant="secondary" className="mt-1 font-mono text-xs">
          {workspace.slug}
        </Badge>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Repository directories</CardTitle>
        </CardHeader>
        <CardContent>
          {repos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No repositories configured.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {repos.map((repo) => (
                <li key={repo} className="font-mono text-xs text-muted-foreground">
                  {repo}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Workspace settings will be available in a future update.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
