'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { OpenDirTree } from '@/components/open-dir/open-dir-tree';
import { useRecentDirs } from '@/hooks/use-recent-dirs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RiSideBarLine, RiFolderOpenLine } from '@remixicon/react';

export default function OpenPage() {
  return (
    <Suspense fallback={null}>
      <OpenPageInner />
    </Suspense>
  );
}

function OpenPageInner() {
  const searchParams = useSearchParams();
  const dirPath = searchParams.get('path') ?? '';
  const { addDir } = useRecentDirs();

  useEffect(() => {
    if (dirPath) addDir(dirPath);
  }, [dirPath, addDir]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        setSidebarWidth(Math.min(384, Math.max(180, startWidth + ev.clientX - startX)));
      };
      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [sidebarWidth],
  );

  if (!dirPath) {
    return (
      <div className="flex h-[calc(100vh-6rem)] flex-col items-center justify-center gap-3">
        <RiFolderOpenLine className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No directory selected.</p>
        <p className="text-xs text-muted-foreground">
          Go back to the home page and open a directory.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)]">
      {!collapsed && (
        <div
          className="shrink-0 overflow-hidden border-r border-border"
          style={{ width: sidebarWidth }}
        >
          <OpenDirTree
            dirPath={dirPath}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
      )}
      <div className="relative flex shrink-0 items-stretch">
        {!collapsed && (
          <div
            className="w-1.5 cursor-col-resize transition-colors hover:bg-primary/30 active:bg-primary/50"
            onMouseDown={handleMouseDown}
          />
        )}
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'absolute top-2 z-10 h-7 w-7 rounded-sm border bg-muted shadow-sm hover:bg-accent',
            collapsed ? 'left-1' : '-left-3.5',
          )}
          onClick={() => setCollapsed((c) => !c)}
        >
          <RiSideBarLine className="size-3.5" />
        </Button>
      </div>
      <div className="min-w-0 flex-1">
        {selectedFile ? (
          <FileEditor dirPath={dirPath} absoluteFilePath={selectedFile} />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
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
  absoluteFilePath: string;
}

function FileEditor({ dirPath, absoluteFilePath }: FileEditorProps) {
  const utils = trpc.useUtils();

  const relPath = absoluteFilePath.startsWith(dirPath + '/')
    ? absoluteFilePath.slice(dirPath.length + 1)
    : absoluteFilePath;

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
      />
    </div>
  );
}
