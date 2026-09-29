'use client';

import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TabCloseMenuProps {
  children: ReactNode;
  tabCount: number;
  isLast: boolean;
  closeShortcut?: string;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
}

export function TabCloseMenu({
  children,
  tabCount,
  isLast,
  closeShortcut,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
}: TabCloseMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuItem onSelect={onClose}>
          Close
          {closeShortcut && <ContextMenuShortcut>{closeShortcut}</ContextMenuShortcut>}
        </ContextMenuItem>
        <ContextMenuItem disabled={tabCount <= 1} onSelect={onCloseOthers}>
          Close others
        </ContextMenuItem>
        <ContextMenuItem disabled={isLast} onSelect={onCloseToRight}>
          Close tabs to the right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={tabCount <= 1} onSelect={onCloseAll}>
          Close all tabs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
