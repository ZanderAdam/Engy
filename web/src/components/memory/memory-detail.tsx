'use client';

import { useRef, useCallback, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DynamicDocumentEditor, type DocumentEditorHandle } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { PromoteDialog } from './promote-dialog';
import { RiDeleteBinLine, RiArrowUpLine, RiExternalLinkLine } from '@remixicon/react';
import { VLink } from '@/components/tabs/virtual-link';
import { cn } from '@/lib/utils';

type MemoryKind = 'permanent' | 'fleeting';

interface MemorySelection {
  id: number;
  kind: MemoryKind;
}

interface MemoryDetailProps {
  selection: MemorySelection;
  workspaceSlug: string;
  repos?: string[];
  onDeleted?: () => void;
}

const SUBTYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  pattern: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  fact: 'bg-green-500/15 text-green-400 border-green-500/20',
  convention: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  insight: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
};

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}:</span>
      <span className="text-[10px] font-mono border border-border px-1.5 py-0.5 text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function PermanentDetail({
  id,
  workspaceSlug,
  onDeleted,
}: {
  id: number;
  workspaceSlug: string;
  onDeleted?: () => void;
}) {
  const utils = trpc.useUtils();
  const editorRef = useRef<DocumentEditorHandle>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: memory, isLoading } = trpc.memory.get.useQuery({ id });

  const updateMutation = trpc.memory.update.useMutation({
    onSuccess: async () => {
      await utils.memory.list.invalidate();
      await utils.memory.get.invalidate({ id });
      setIsSaving(false);
    },
    onError: () => setIsSaving(false),
  });

  const deleteMutation = trpc.memory.delete.useMutation({
    onSuccess: async () => {
      await utils.memory.list.invalidate();
      onDeleted?.();
    },
    onError: (err) => {
      setDeleteError(err.message);
    },
  });

  const memoryFilePath = memory?.filePath ?? null;
  const threadStore = useMemo(() => {
    if (!memoryFilePath) return undefined;
    return new EngyThreadStore(workspaceSlug, memoryFilePath);
  }, [workspaceSlug, memoryFilePath]);

  const handleSave = useCallback(
    (markdown: string) => {
      if (!memory) return;
      setIsSaving(true);
      updateMutation.mutate({ id, content: markdown });
    },
    [id, memory, updateMutation],
  );

  function confirmDelete() {
    deleteMutation.mutate({ id });
    setDeleteOpen(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Memory not found</p>
      </div>
    );
  }

  const tags = Array.isArray(memory.tags) ? (memory.tags as string[]) : [];
  const themes = Array.isArray(memory.themes) ? (memory.themes as string[]) : [];
  const keywords = Array.isArray(memory.keywords) ? (memory.keywords as string[]) : [];
  const sources = Array.isArray(memory.sources) ? (memory.sources as string[]) : [];
  const linkedMemories = Array.isArray(memory.linkedMemories)
    ? (memory.linkedMemories as string[])
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-medium leading-snug truncate">{memory.title}</h2>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center h-4 px-1.5 text-[10px] font-medium border',
                SUBTYPE_COLORS[memory.subtype] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {memory.subtype}
            </span>
            {memory.repo && (
              <span className="inline-flex items-center h-4 px-1.5 text-[10px] font-mono border border-border text-muted-foreground">
                {memory.repo}
              </span>
            )}
            {memory.confidence != null && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {Math.round(memory.confidence * 100)}% confidence
              </span>
            )}
            {isSaving && (
              <span className="text-[10px] text-muted-foreground/60 animate-pulse">Saving…</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteOpen(true)}
            disabled={deleteMutation.isPending}
            className="text-muted-foreground hover:text-destructive"
            title="Delete memory"
          >
            <RiDeleteBinLine className="size-3.5" />
          </Button>
        </div>
      </div>
      {deleteError && (
        <p className="text-xs text-destructive px-4 py-1 border-b border-border">{deleteError}</p>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <DynamicDocumentEditor
          ref={editorRef}
          initialMarkdown={memory.content}
          onSave={handleSave}
          comments={!!threadStore}
          threadStore={threadStore}
          filePath={memory.filePath ?? undefined}
        />
      </div>

      {/* Metadata footer */}
      <ScrollArea className="shrink-0 max-h-40 border-t border-border">
        <div className="px-4 py-3 flex flex-col gap-2.5">
          {tags.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Tags
              </span>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] h-4 px-1.5">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {themes.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Themes
              </span>
              <div className="flex flex-wrap gap-1">
                {themes.map((theme) => (
                  <Badge key={theme} variant="secondary" className="text-[10px] h-4 px-1.5">
                    {theme}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {keywords.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Keywords
              </span>
              <div className="flex flex-wrap gap-1">
                {keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="text-[10px] h-4 px-1.5">
                    {kw}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {sources.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Sources
              </span>
              <div className="flex flex-wrap gap-1">
                {sources.map((src) => (
                  <span
                    key={src}
                    className="text-[10px] font-mono border border-border px-1.5 py-0.5 text-muted-foreground"
                  >
                    {src}
                  </span>
                ))}
              </div>
            </div>
          )}

          {linkedMemories.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Linked Memories
              </span>
              <div className="flex flex-wrap gap-1">
                {linkedMemories.map((path) => (
                  <VLink
                    key={path}
                    href={`/w/${workspaceSlug}/memory?path=${encodeURIComponent(path)}`}
                    className="inline-flex items-center gap-0.5 text-[10px] font-mono border border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors cursor-pointer"
                  >
                    <RiExternalLinkLine className="size-2.5" />
                    {path.split('/').pop() ?? path}
                  </VLink>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <MetaChip label="created" value={new Date(memory.createdAt).toLocaleDateString()} />
            <MetaChip label="updated" value={new Date(memory.updatedAt).toLocaleDateString()} />
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{memory.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the memory and its markdown file. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FleetingDetail({
  id,
  workspaceSlug,
  repos,
}: {
  id: number;
  workspaceSlug: string;
  repos: string[];
}) {
  const [promoteOpen, setPromoteOpen] = useState(false);

  const { data: candidates, isLoading } = trpc.memory.reviewCandidates.useQuery({
    workspaceSlug,
    limit: 200,
  });

  const fleeting = candidates?.find((c) => c.id === id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!fleeting) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Fleeting memory not found</p>
      </div>
    );
  }

  const tags = Array.isArray(fleeting.tags) ? (fleeting.tags as string[]) : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono border border-border px-1.5 py-0.5 text-muted-foreground">
            {fleeting.type}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(fleeting.createdAt).toLocaleDateString()}
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => setPromoteOpen(true)}
          className="h-7 gap-1"
        >
          <RiArrowUpLine className="size-3.5" />
          Promote…
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-3">
          <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
            {fleeting.content}
          </p>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px] h-4 px-1.5">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {promoteOpen && (
        <PromoteDialog
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          fleeting={fleeting}
          workspaceSlug={workspaceSlug}
          repos={repos}
        />
      )}
    </div>
  );
}

export function MemoryDetail({ selection, workspaceSlug, repos = [], onDeleted }: MemoryDetailProps) {
  if (selection.kind === 'permanent') {
    return (
      <PermanentDetail
        id={selection.id}
        workspaceSlug={workspaceSlug}
        onDeleted={onDeleted}
      />
    );
  }

  return (
    <FleetingDetail
      id={selection.id}
      workspaceSlug={workspaceSlug}
      repos={repos}
    />
  );
}
