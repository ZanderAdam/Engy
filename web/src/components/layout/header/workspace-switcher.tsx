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

interface WorkspaceSwitcherProps {
  currentSlug: string;
  children: React.ReactNode;
}

export function WorkspaceSwitcher({ currentSlug, children }: WorkspaceSwitcherProps) {
  const { data: workspaces } = trpc.workspace.list.useQuery();
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
        <DropdownMenuLabel className="text-[10px]">Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(workspaces ?? []).map((ws) => {
          const isActive = ws.slug === currentSlug;
          return (
            <DropdownMenuItem
              key={ws.id}
              onSelect={() => push(`/w/${ws.slug}`)}
              aria-current={isActive || undefined}
              className={cn(isActive && 'font-medium')}
            >
              <span className="truncate">{ws.name}</span>
              {isActive && <RiCheckLine className="ml-auto size-3" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
