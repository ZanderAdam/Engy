'use client';

import path from 'path';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { FileTree } from '@/components/file-tree';
import { useRecentDirs } from '@/hooks/use-recent-dirs';
import { ThreePanelLayout, type ShortcutDef } from '@/components/layout/three-panel-layout';
import { TerminalManager } from '@/components/terminal/terminal-manager';
import type { TerminalScope } from '@/components/terminal/types';
import { RiFolderOpenLine } from '@remixicon/react';

const LEFT_PANEL_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-open-sidebar-width',
} as const;

const TERMINAL_CONFIG = {
  defaultWidth: 480,
  minWidth: 240,
  maxWidth: 900,
  storageKey: 'engy-open-terminal-width',
} as const;

const TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: '`' };

export default function OpenPage() {
  return (
    <Suspense fallback={null}>
      <OpenPageOuter />
    </Suspense>
  );
}

function OpenPageOuter() {
  const searchParams = useSearchParams();
  const dirPath = searchParams.get('path') ?? '';

  if (!dirPath) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3">
        <RiFolderOpenLine className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No directory selected.</p>
        <p className="text-xs text-muted-foreground">
          Go back to the home page and open a directory.
        </p>
      </div>
    );
  }

  return <OpenPageInner key={dirPath} dirPath={dirPath} />;
}

function OpenPageInner({ dirPath }: { dirPath: string }) {
  const { addDir } = useRecentDirs();

  useEffect(() => {
    if (dirPath) addDir(dirPath);
  }, [dirPath, addDir]);

  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

  const terminalScope = useMemo<TerminalScope>(
    () => ({
      scopeType: 'dir',
      scopeLabel: dirPath,
      workingDir: dirPath,
    }),
    [dirPath],
  );

  const handleTerminalCollapse = useCallback(() => {
    setTerminalCollapsed(true);
  }, []);

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={LEFT_PANEL_CONFIG}
      right={TERMINAL_CONFIG}
      rightCollapsed={terminalCollapsed}
      onRightCollapsedChange={setTerminalCollapsed}
      rightShortcut={TERMINAL_SHORTCUT}
      leftContent={
        <DirFileTree
          dirPath={dirPath}
          selectedFile={selectedRelPath}
          onSelectFile={setSelectedRelPath}
        />
      }
      centerContent={
        selectedRelPath ? (
          <FileEditor dirPath={dirPath} relPath={selectedRelPath} />
        ) : (
          <EmptyState />
        )
      }
      rightContent={
        <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
          <TerminalManager
            onCollapse={handleTerminalCollapse}
            defaultScope={terminalScope}
          />
        </div>
      }
    />
  );
}

function DirFileTree({
  dirPath,
  selectedFile,
  onSelectFile,
}: {
  dirPath: string;
  selectedFile: string | null;
  onSelectFile: (relPath: string) => void;
}) {
  const { data, isLoading } = trpc.dir.listFiles.useQuery({ dirPath });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <FileTree
      files={data?.files ?? []}
      selectedFile={selectedFile}
      onSelectFile={onSelectFile}
      label={path.basename(dirPath) || dirPath}
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <RiFolderOpenLine className="size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">Select a file to edit</p>
    </div>
  );
}

interface FileEditorProps {
  dirPath: string;
  relPath: string;
}

function FileEditor({ dirPath, relPath }: FileEditorProps) {
  const utils = trpc.useUtils();
  const absoluteFilePath = path.join(dirPath, relPath);

  const threadStore = useMemo(
    () => new EngyThreadStore(undefined, absoluteFilePath),
    [absoluteFilePath],
  );

  const { data, isLoading, error } = trpc.dir.read.useQuery({
    dirPath,
    filePath: relPath,
  });

  const writeMutation = trpc.dir.write.useMutation({
    onSuccess: () => utils.dir.read.invalidate({ dirPath, filePath: relPath }),
  });

  const handleSave = useCallback(
    (markdown: string) => {
      writeMutation.mutate({ dirPath, filePath: relPath, content: markdown });
    },
    [writeMutation, dirPath, relPath],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium">Failed to load file</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <DynamicDocumentEditor
        key={absoluteFilePath}
        initialMarkdown={data?.content ?? ''}
        onSave={handleSave}
        comments={true}
        threadStore={threadStore}
        filePath={relPath}
        mentionDirs={[dirPath]}
      />
    </div>
  );
}
