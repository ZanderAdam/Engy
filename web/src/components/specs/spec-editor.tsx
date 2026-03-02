"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { CommentsExtension } from "@blocknote/core/comments";
import type { User } from "@blocknote/core/comments";
import { ThreadsSidebar, FloatingComposerController } from "@blocknote/react";
import "@blocknote/shadcn/style.css";
import { trpc } from "@/lib/trpc";
import { EngyThreadStore } from "./thread-store";

const USER_ID = "local-user";
const LOCAL_USER: User = { id: USER_ID, username: "You", avatarUrl: "" };

async function resolveUsers(): Promise<User[]> {
  return [LOCAL_USER];
}

interface SpecEditorProps {
  workspaceSlug: string;
  specSlug: string;
  documentPath: string;
  initialBody: string;
  editorJson: unknown[] | null;
  showComments?: boolean;
}

const AUTOSAVE_DELAY_MS = 1500;

export function SpecEditor({
  workspaceSlug,
  specSlug,
  documentPath,
  initialBody,
  editorJson,
  showComments,
}: SpecEditorProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);
  const utils = trpc.useUtils();

  const updateMutation = trpc.spec.update.useMutation({
    onSuccess: () => {
      utils.spec.get.invalidate({ workspaceSlug, specSlug });
    },
    onError: (err) => {
      console.error("[spec-editor] autosave failed:", err.message);
    },
  });

  const mutateRef = useRef(updateMutation.mutate);
  useEffect(() => {
    mutateRef.current = updateMutation.mutate;
  }, [updateMutation.mutate]);

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, documentPath),
    [workspaceSlug, documentPath],
  );

  const editor = useCreateBlockNote(
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialContent: editorJson ? (editorJson as any) : undefined,
      extensions: [CommentsExtension({ threadStore, resolveUsers })],
    },
    [threadStore],
  );

  useEffect(() => {
    if (editorJson || !initialBody || loadedRef.current) return;
    loadedRef.current = true;
    async function loadContent() {
      const blocks = await editor.tryParseMarkdownToBlocks(initialBody);
      editor.replaceBlocks(editor.document, blocks);
    }
    loadContent();
  }, [editor, initialBody, editorJson]);

  const handleChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      mutateRef.current({
        workspaceSlug,
        specSlug,
        body: markdown,
        editorJson: editor.document as unknown[],
      });
    }, AUTOSAVE_DELAY_MS);
  }, [editor, workspaceSlug, specSlug]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <BlockNoteView editor={editor} onChange={handleChange} theme="dark" className="flex flex-1 overflow-hidden">
      <FloatingComposerController />
      {showComments && (
        <aside className="w-72 shrink-0 border-l border-border overflow-auto">
          <ThreadsSidebar />
        </aside>
      )}
    </BlockNoteView>
  );
}
