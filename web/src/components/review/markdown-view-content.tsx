'use client';

import { useEffect } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import '@blocknote/react/style.css';

export default function MarkdownViewContent({ markdown }: { markdown: string }) {
  const editor = useCreateBlockNote();

  useEffect(() => {
    editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(markdown));
  }, [editor, markdown]);

  return (
    <BlockNoteView
      editor={editor}
      editable={false}
      theme="dark"
      className="[&_.bn-editor]:!bg-transparent [&_.bn-editor]:!p-0 [&_.bn-block-content]:!text-sm [&_h1]:!text-lg [&_h2]:!text-base [&_h3]:!text-sm"
      slashMenu={false}
      formattingToolbar={false}
      linkToolbar={false}
      sideMenu={false}
    />
  );
}
