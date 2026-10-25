'use client';

import { useEffect } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import '@blocknote/react/style.css';
import { cn } from '@/lib/utils';

interface MarkdownViewContentProps {
  markdown: string;
  className?: string;
}

export default function MarkdownViewContent({ markdown, className }: MarkdownViewContentProps) {
  const editor = useCreateBlockNote();

  useEffect(() => {
    editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(markdown));
  }, [editor, markdown]);

  return (
    <BlockNoteView
      editor={editor}
      editable={false}
      theme="dark"
      className={cn(
        '[&_.bn-editor]:!bg-transparent [&_.bn-editor]:!p-0 [&_.bn-block-content]:!text-sm [&_h1]:!text-lg [&_h2]:!text-base [&_h3]:!text-sm',
        className,
      )}
      slashMenu={false}
      formattingToolbar={false}
      linkToolbar={false}
      sideMenu={false}
    />
  );
}
