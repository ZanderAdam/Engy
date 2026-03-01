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
  const utils = trpc.useUtils();

  const updateMutation = trpc.spec.update.useMutation({
    onSuccess: () => {
      utils.spec.get.invalidate({ workspaceSlug, specSlug });
    },
  });

  const editor = useCreateBlockNote({
    initialContent: initialBody
      ? undefined
      : [{ type: "paragraph", content: "" }],
  });

  // Load initial markdown content
  useEffect(() => {
    if (!initialBody) return;
    async function loadContent() {
      const blocks = await editor.tryParseMarkdownToBlocks(initialBody);
      editor.replaceBlocks(editor.document, blocks);
    }
    loadContent();
  }, [editor, initialBody]);

  const handleChange = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      updateMutation.mutate({
        workspaceSlug,
        specSlug,
        body: markdown,
      });
    }, AUTOSAVE_DELAY_MS);
  }, [editor, workspaceSlug, specSlug, updateMutation]);

  // Cleanup timer on unmount
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
