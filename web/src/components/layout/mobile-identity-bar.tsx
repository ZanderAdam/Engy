'use client';

import { useEffect, useRef } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { useTabsList } from '@/components/tabs/tab-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProjectActivityBadge } from '@/components/projects/project-activity-badge';
import { WorkspaceSwitcher } from './header/workspace-switcher';
import { ProjectSwitcher } from './header/project-switcher';
import { OpenTabsPicker } from '@/components/tabs/open-tabs-picker';
import { HeaderActions } from '@/components/header-actions';
import { useOptionalMobileOverlay } from './mobile-overlay-context';

interface WorkspaceLike {
  id: number;
  slug: string;
  name: string;
}

interface ProjectLike {
  id: number;
  slug: string;
  name: string;
}

interface MobileIdentityBarProps {
  workspace?: WorkspaceLike;
  project?: ProjectLike;
}

/**
 * Mobile top bar: workspace › project › open-tabs picker, plus header actions.
 * Mounted on every mobile screen — including the workspace picker, which has
 * no workspace/project of its own — so tab switching is always reachable.
 */
export function MobileIdentityBar({ workspace, project }: MobileIdentityBarProps) {
  const tabsList = useTabsList();
  const overlay = useOptionalMobileOverlay();
  const setHeaderHeight = overlay?.setHeaderHeight;
  const rowRef = useRef<HTMLDivElement>(null);

  // Publish the bar's live height so full-screen overlays (terminal sheets) sit
  // just below it — covering the section-tabs row but keeping workspace/project/tab
  // switching reachable. Resets to 0 on unmount so overlays go full-screen without it.
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !setHeaderHeight) return;
    const apply = () => setHeaderHeight(el.offsetHeight);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHeaderHeight(0);
    };
  }, [setHeaderHeight]);

  const totalTabs = tabsList?.tabs.length ?? 1;
  const rawActiveIdx = tabsList?.tabs.findIndex((t) => t.id === tabsList.activeTabId) ?? 0;
  const activeIdx = Math.max(0, rawActiveIdx);
  const tabPosition = `${activeIdx + 1}/${totalTabs}`;

  const activeTab = tabsList?.tabs.find((t) => t.id === tabsList.activeTabId);
  const tabLabel = project?.name ?? workspace?.name ?? activeTab?.title ?? 'engy';

  return (
    // `sticky` is required by the standalone mounts (workspace picker, workspace
    // routes) which have no sticky ancestor; it is redundant but harmless when
    // nested inside MobileHeader's own sticky <header>.
    <div
      ref={rowRef}
      className="sticky top-0 z-30 flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-2"
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0">
        {workspace && (
          <>
            <WorkspaceSwitcher currentSlug={workspace.slug}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 max-w-[6rem] truncate px-1.5 text-xs text-muted-foreground"
              >
                {workspace.name}
              </Button>
            </WorkspaceSwitcher>
            <span className="text-muted-foreground px-0.5">›</span>
          </>
        )}
        {workspace && project && (
          <>
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
            <ProjectActivityBadge projectSlug={project.slug} />
            <span className="text-muted-foreground px-0.5">›</span>
          </>
        )}
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
  );
}
