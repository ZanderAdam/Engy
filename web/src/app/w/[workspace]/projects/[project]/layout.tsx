"use client";

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", segment: "", disabled: false },
  { label: "Docs", segment: "docs", disabled: false },
  { label: "Tasks", segment: "tasks", disabled: false },
  { label: "Diffs", segment: "diffs", disabled: true, hint: "Available in M6" },
  { label: "PRs", segment: "prs", disabled: true, hint: "Available in M12" },
] as const;

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspace: string; project: string }>();
  const pathname = usePathname();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project },
    { enabled: !!workspace },
  );

  if (!workspace || !project) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  const basePath = `/w/${params.workspace}/projects/${params.project}`;

  function tabHref(segment: string): string {
    return segment ? `${basePath}/${segment}` : basePath;
  }

  function isActive(segment: string): boolean {
    if (segment === "") {
      return pathname === basePath;
    }
    return pathname.startsWith(`${basePath}/${segment}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-0 py-3">
        <h1 className="text-sm font-semibold">{project.name}</h1>
        <Badge variant="secondary" className="text-[10px]">
          {project.status}
        </Badge>
      </div>

      <nav className="border-b border-border" aria-label="Project sections">
        <TooltipProvider>
          <div className="flex">
            {tabs.map((tab) =>
              tab.disabled ? (
                <Tooltip key={tab.segment}>
                  <TooltipTrigger asChild>
                    <span className="cursor-not-allowed px-3 py-2.5 text-xs font-medium text-muted-foreground/50">
                      {tab.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{tab.hint}</TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  key={tab.segment}
                  href={tabHref(tab.segment)}
                  className={cn(
                    "relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                    isActive(tab.segment) &&
                      "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground",
                  )}
                >
                  {tab.label}
                </Link>
              ),
            )}
          </div>
        </TooltipProvider>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
