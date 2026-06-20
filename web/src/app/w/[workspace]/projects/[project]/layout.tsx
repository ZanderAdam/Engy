"use client";

import { useState } from "react";
import { useVirtualParams, useVirtualPathname, useVirtualSearchParams } from "@/components/tabs/tab-context";
import { VLink } from "@/components/tabs/virtual-link";
import { trpc } from "@/lib/trpc";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RiGitBranchLine } from "@remixicon/react";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { WorktreeDropdown } from "@/components/projects/worktree-dropdown";
import { ManageWorktreesDialog } from "@/components/projects/manage-worktrees-dialog";
import { sections as tabs } from "@/components/layout/header/sections";
import { MobileHeader } from "@/components/layout/mobile-header";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const isMobile = useIsMobile();
  const [manageOpen, setManageOpen] = useState(false);

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
  const workspaceRepoCount = ((workspace.repos as string[] | null) ?? []).length;
  const combinedWorktrees = workspace.combinedWorktrees ?? false;
  const searchString = searchParams.toString();

  function tabHref(segment: string): string {
    const base = segment ? `${basePath}/${segment}` : basePath;
    return searchString ? `${base}?${searchString}` : base;
  }

  function isActive(segment: string): boolean {
    if (segment === "") {
      return pathname === basePath;
    }
    return pathname.startsWith(`${basePath}/${segment}`);
  }

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <MobileHeader
          workspace={workspace}
          project={project}
          onOpenManageWorktrees={() => setManageOpen(true)}
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        {workspaceRepoCount > 0 && (
          <ManageWorktreesDialog
            open={manageOpen}
            onOpenChange={setManageOpen}
            projectId={project.id}
            workspaceRepos={(workspace.repos as string[]) ?? []}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 py-2" aria-label="Project header">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <VLink href="/" className="hover:text-foreground">
            engy
          </VLink>
          <span className="opacity-60">›</span>
          <VLink href={`/w/${params.workspace}`} className="hover:text-foreground">
            {workspace.name}
          </VLink>
          <span className="opacity-60">›</span>
        </nav>
        <h1 className="text-sm font-semibold">{project.name}</h1>
        {workspaceRepoCount > 0 &&
          (combinedWorktrees ? (
            <button
              type="button"
              aria-label="Manage worktrees"
              title="Manage worktrees"
              onClick={() => setManageOpen(true)}
              className="flex items-center gap-1 rounded-sm border border-input/40 bg-input/30 px-2 py-0.5 text-xs hover:bg-muted"
            >
              <RiGitBranchLine className="size-3 shrink-0 text-muted-foreground" />
              <span>Worktrees</span>
            </button>
          ) : (
            <WorktreeDropdown
              projectId={project.id}
              workspaceRepoCount={workspaceRepoCount}
              onOpenManage={() => setManageOpen(true)}
            />
          ))}
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

      <nav className="flex items-stretch border-b border-border" aria-label="Project sections">
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
        <div className="flex-1" />
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      {workspaceRepoCount > 0 && (
        <ManageWorktreesDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          projectId={project.id}
          workspaceRepos={(workspace.repos as string[]) ?? []}
        />
      )}
    </div>
  );
}
