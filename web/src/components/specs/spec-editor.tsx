"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { trpc } from "@/lib/trpc";

interface SpecEditorProps {
  workspaceSlug: string;
  specSlug: string;
  initialBody: string;
}

const AUTOSAVE_DELAY_MS = 1500;

export function SpecEditor({
  workspaceSlug,
  specSlug,
  initialBody,
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

  const editor = useCreateBlockNote({
    initialContent: initialBody
      ? undefined
      : [{ type: "paragraph", content: "" }],
  });

  useEffect(() => {
    if (!initialBody || loadedRef.current) return;
    loadedRef.current = true;
    async function loadContent() {
      const blocks = await editor.tryParseMarkdownToBlocks(initialBody);
      editor.replaceBlocks(editor.document, blocks);
    }
    loadContent();
  }, [editor, initialBody]);

  const handleChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      mutateRef.current({
        workspaceSlug,
        specSlug,
        body: markdown,
      });
    }, AUTOSAVE_DELAY_MS);
  }, [editor, workspaceSlug, specSlug]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
        theme="dark"
        className="min-h-[400px]"
      />
    </div>
  );
}
