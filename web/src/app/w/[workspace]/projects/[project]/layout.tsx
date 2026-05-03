"use client";

import { useVirtualParams, useVirtualPathname } from "@/components/tabs/tab-context";
import { VLink } from "@/components/tabs/virtual-link";
import { trpc } from "@/lib/trpc";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", segment: "", disabled: false },
  { label: "Docs", segment: "docs", disabled: false },
  { label: "Tasks", segment: "tasks", disabled: false },
  { label: "Claude Plans", segment: "claude-plans", disabled: false },
  { label: "Diffs", segment: "diffs", disabled: false },
  { label: "Code", segment: "code", disabled: false },
  { label: "PRs", segment: "prs", disabled: true, hint: "Available in M12" },
] as const;

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const pathname = useVirtualPathname();

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
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground"
      >
        <VLink href="/" className="hover:text-foreground">
          engy
        </VLink>
        <span className="opacity-60">›</span>
        <VLink href={`/w/${params.workspace}`} className="hover:text-foreground">
          {workspace.name}
        </VLink>
      </nav>
      <div className="flex items-center gap-3 py-2">
        <h1 className="text-sm font-semibold">{project.name}</h1>
        <ProjectStatusBadge projectId={project.id} status={project.status} clickable />
        {workspace.autoStart && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-emerald-500" aria-label="Auto-start enabled">
                  <i className="ri-settings-3-line text-sm" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Auto</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Auto-start is enabled — AI tasks will begin automatically.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <nav className="flex border-b border-border" aria-label="Project sections">
        <TooltipProvider>
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
              <VLink
                key={tab.segment}
                href={tabHref(tab.segment)}
                className={cn(
                  "relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                  isActive(tab.segment) &&
                    "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground",
                )}
              >
                {tab.label}
              </VLink>
            ),
          )}
        </TooltipProvider>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
