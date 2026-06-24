'use client';

import { useState, type ReactNode } from 'react';
import { RiFileList2Line, RiListUnordered } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { DocOutline } from './doc-outline-view';
import type { DocOutlineState } from './doc-outline';

interface DocsSidebarProps {
  /** Active document's outline, or null when no document is open. */
  outline: DocOutlineState | null;
  /**
   * Renders the file-tree view. Receives the Files/Outline toggle so it can
   * place it in the tree's own header — avoiding a duplicate header bar.
   */
  renderFiles: (headerExtra: ReactNode) => ReactNode;
}

/**
 * Left docs panel that swaps between the file tree and the active document's
 * outline. A single toggle in the header switches views; the same control
 * lives in both headers so it is always one click away.
 */
export function DocsSidebar({ outline, renderFiles }: DocsSidebarProps) {
  const [view, setView] = useState<'files' | 'outline'>('files');

  const toggle = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setView((v) => (v === 'files' ? 'outline' : 'files'))}
      className="h-6 w-6 p-0 text-muted-foreground"
      title={view === 'files' ? 'Show outline' : 'Show files'}
      aria-label={view === 'files' ? 'Show outline' : 'Show files'}
    >
      {view === 'files' ? (
        <RiListUnordered className="size-3.5" />
      ) : (
        <RiFileList2Line className="size-3.5" />
      )}
    </Button>
  );

  if (view === 'outline') {
    return <DocOutline outline={outline} headerExtra={toggle} />;
  }
  return <>{renderFiles(toggle)}</>;
}
