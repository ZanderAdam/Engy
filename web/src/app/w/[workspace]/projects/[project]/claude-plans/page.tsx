'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { DirFileTree, DirFileEditor, DirEmptyState } from '@/components/dir-browser';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';

const SIDEBAR_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 900,
  storageKey: 'engy-claude-plans-sidebar-width',
} as const;

export default function ClaudePlansPage() {
  const { data: homeData } = trpc.dir.home.useQuery();
  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);

  if (!homeData) return null;

  const plansDir = `${homeData.path}/.claude/plans`;

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      leftContent={
        <DirFileTree
          dirPath={plansDir}
          selectedFile={selectedRelPath}
          onSelectFile={setSelectedRelPath}
        />
      }
      centerContent={
        selectedRelPath ? (
          <DirFileEditor dirPath={plansDir} relPath={selectedRelPath} />
        ) : (
          <DirEmptyState />
        )
      }
    />
  );
}
