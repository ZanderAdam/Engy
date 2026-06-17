'use client';

import { RiFileWarningLine } from '@remixicon/react';

interface UnsupportedFilePreviewProps {
  fileName: string;
}

/** Info card shown for binary files that can't be rendered in the editor. */
export function UnsupportedFilePreview({ fileName }: UnsupportedFilePreviewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <RiFileWarningLine className="size-10 text-muted-foreground/50" />
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium">{fileName}</p>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          This file type can&apos;t be previewed. Use the file tree to rename, copy its path, or
          delete it.
        </p>
      </div>
    </div>
  );
}
