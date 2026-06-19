'use client';

import { RiCheckLine } from '@remixicon/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpc } from '@/lib/trpc';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { cn } from '@/lib/utils';
import { ProjectActivityBadge } from '@/components/projects/project-activity-badge';

interface ProjectSwitcherProps {
  workspaceId: number;
  workspaceSlug: string;
  currentSlug: string;
  children: React.ReactNode;
}

export function ProjectSwitcher({
  workspaceId,
  workspaceSlug,
  currentSlug,
  children,
}: ProjectSwitcherProps) {
  const { data: projects } = trpc.project.list.useQuery({ workspaceId });
  const { push } = useVirtualNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        alignOffset={-9999}
        collisionPadding={8}
        className="md:min-w-[12rem] md:w-auto md:max-w-none w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuLabel className="text-[10px]">Projects</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(projects ?? []).map((p) => {
          const isActive = p.slug === currentSlug;
          return (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => push(`/w/${workspaceSlug}/projects/${p.slug}`)}
              aria-current={isActive || undefined}
              className={cn(isActive && 'font-medium')}
            >
              <span className="truncate">{p.name}</span>
              <ProjectActivityBadge projectSlug={p.slug} className="ml-auto" />
              {isActive && <RiCheckLine className="size-3" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
