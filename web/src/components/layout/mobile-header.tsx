'use client';

import { useEffect, useRef } from 'react';
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiFolderLine,
  RiTerminalLine,
} from '@remixicon/react';
import {
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
  useTabsList,
} from '@/components/tabs/tab-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { sections, activeSection } from './header/sections';
import { WorkspaceSwitcher } from './header/workspace-switcher';
import { ProjectSwitcher } from './header/project-switcher';
import { OpenTabsPicker } from './header/open-tabs-picker';
import { WorktreeDropdown } from '@/components/projects/worktree-dropdown';
import { HeaderActions } from '@/components/header-actions';
import { useMobileOverlay } from './mobile-overlay-context';

interface WorkspaceLike {
  id: number;
  slug: string;
  name: string;
  repos: unknown;
}

interface ProjectLike {
  id: number;
  slug: string;
  name: string;
}

interface MobileHeaderProps {
  workspace?: WorkspaceLike;
  project?: ProjectLike;
  onOpenManageWorktrees?: () => void;
}

export function MobileHeader({ workspace, project, onOpenManageWorktrees }: MobileHeaderProps) {
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const navigate = useVirtualNavigate();
  const tabsList = useTabsList();
  const { overlay, openOverlay, closeOverlay, setHeaderHeight } = useMobileOverlay();
  const identityRowRef = useRef<HTMLDivElement>(null);

  // Publish the identity bar's live height so full-screen overlays (terminal
  // sheets) sit just below it — covering the section-tabs row but keeping
  // workspace/project/tab switching reachable. Resets to 0 on unmount so
  // overlays go full-screen on routes without the header.
  useEffect(() => {
    const el = identityRowRef.current;
    if (!el) return;
    const apply = () => setHeaderHeight(el.offsetHeight);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHeaderHeight(0);
    };
  }, [setHeaderHeight]);

  const workspaceRepoCount = ((workspace?.repos as string[] | null) ?? []).length;

  const totalTabs = tabsList?.tabs.length ?? 1;
  const rawActiveIdx = tabsList?.tabs.findIndex((t) => t.id === tabsList.activeTabId) ?? 0;
  const activeIdx = Math.max(0, rawActiveIdx);
  const tabPosition = `${activeIdx + 1}/${totalTabs}`;

  const basePath =
    workspace && project
      ? `/w/${workspace.slug}/projects/${project.slug}`
      : workspace
        ? `/w/${workspace.slug}`
        : '/';

  const current =
    workspace && project ? (activeSection(pathname, basePath) ?? sections[0]) : undefined;
  const enabledSections = sections.filter((s) => !s.disabled);
  const sectionPosition = current
    ? `${enabledSections.findIndex((s) => s.segment === current.segment) + 1}/${enabledSections.length}`
    : '';

  const searchString = searchParams.toString();
  function sectionHref(segment: string): string {
    const base = segment ? `${basePath}/${segment}` : basePath;
    return searchString ? `${base}?${searchString}` : base;
  }

  const activeTab = tabsList?.tabs.find((t) => t.id === tabsList.activeTabId);
  const tabLabel =
    project?.name ?? workspace?.name ?? activeTab?.title ?? 'engy';

  const filesAvailable =
    current?.segment === 'docs' || current?.segment === 'diffs' || current?.segment === 'code';

  return (
    <header className="sticky top-0 z-30 flex shrink-0 flex-col bg-background">
      {/* Row 1 — Identity bar */}
      <div
        ref={identityRowRef}
        className="flex h-11 items-center justify-between border-b border-border bg-card px-2"
      >
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-0"
        >
          {workspace && (
            <WorkspaceSwitcher currentSlug={workspace.slug}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 max-w-[6rem] truncate px-1.5 text-xs text-muted-foreground"
              >
                {workspace.name}
              </Button>
            </WorkspaceSwitcher>
          )}
          {workspace && project && (
            <>
              <span className="text-muted-foreground px-0.5">›</span>
              <ProjectSwitcher
                workspaceId={workspace.id}
                workspaceSlug={workspace.slug}
                currentSlug={project.slug}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-[6rem] truncate px-1.5 text-xs text-muted-foreground"
                >
                  {project.name}
                </Button>
              </ProjectSwitcher>
            </>
          )}
          <span className="text-muted-foreground px-0.5">›</span>
          <OpenTabsPicker>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-1.5 text-sm font-semibold"
            >
              <span className="truncate">{tabLabel}</span>
              <Badge variant="secondary" className="text-[10px]">
                {tabPosition}
              </Badge>
              <RiArrowDownSLine className="size-3" />
            </Button>
          </OpenTabsPicker>
        </nav>

        <div className="flex shrink-0 items-center pl-1">
          <HeaderActions />
        </div>
      </div>

      {/* Row 2 — Section tabs */}
      {workspace && project && current && (
        <div className="flex h-11 items-stretch border-b border-border bg-background">
          {filesAvailable && (
            <div className="flex shrink-0 items-center border-r border-border px-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                aria-pressed={overlay === 'files'}
                onClick={() => (overlay === 'files' ? closeOverlay() : openOverlay('files'))}
                aria-label="Toggle files"
              >
                <RiFolderLine className="size-3.5" />
              </Button>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-full flex-1 justify-between rounded-none px-3"
              >
                <span className="flex items-center gap-1.5">
                  <current.icon className="size-3.5" />
                  <span className="text-sm font-medium">{current.label}</span>
                  <RiArrowDownSLine className="size-3.5" />
                </span>
                <span className="text-xs text-muted-foreground">{sectionPosition}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem] md:w-auto w-[calc(100vw-1rem)]">
              {sections.map((s) => {
                const Icon = s.icon;
                const isActive = s.segment === current.segment;
                return (
                  <DropdownMenuItem
                    key={s.segment || 'overview'}
                    disabled={s.disabled}
                    onSelect={(e) => {
                      if (s.disabled) {
                        e.preventDefault();
                        return;
                      }
                      navigate.push(sectionHref(s.segment));
                    }}
                    className={cn(isActive && 'font-medium')}
                    aria-current={isActive || undefined}
                  >
                    <Icon className="size-3" />
                    <span>{s.label}</span>
                    {isActive && <RiCheckLine className="ml-auto size-3" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex shrink-0 items-center gap-1 border-l border-border px-1.5">
            {workspaceRepoCount > 0 && onOpenManageWorktrees && (
              <WorktreeDropdown
                projectId={project.id}
                workspaceRepoCount={workspaceRepoCount}
                onOpenManage={onOpenManageWorktrees}
                hideManageButton
              />
            )}
            {/* Opens the RIGHT terminal (Claude/agent). The BOTTOM shell
                terminal is opened from the floating toggle, not here. */}
            <Button
              variant="outline"
              size="icon-sm"
              aria-pressed={overlay === 'terminal'}
              onClick={() => (overlay === 'terminal' ? closeOverlay() : openOverlay('terminal'))}
              aria-label="Toggle Claude terminal"
            >
              <RiTerminalLine className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

    </header>
  );
}
