'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import type { GitFileStatus } from './types';

interface ImageSide {
  isLoading: boolean;
  error: { message: string } | null;
  dataUri?: string;
}

function ImagePane({
  label,
  side,
  fileName,
}: {
  label: string;
  side: ImageSide;
  fileName: string;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">{label}</div>
      {side.isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : side.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 px-3 text-center">
          <p className="text-xs text-destructive">{side.error.message}</p>
        </div>
      ) : side.dataUri ? (
        <div className="relative min-h-0 flex-1 bg-muted/30">
          <Image
            src={side.dataUri}
            alt={`${label} — ${fileName}`}
            fill
            unoptimized
            sizes="50vw"
            className="object-contain p-4"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30">
          <p className="text-sm text-muted-foreground">No content</p>
        </div>
      )}
    </div>
  );
}

/**
 * Before/after preview for an image file in the diff viewer. Added files show
 * only the new image, deleted files only the old one, and modified/renamed
 * files show both side by side.
 */
export function ImageDiffView({
  status,
  original,
  modified,
  fileName,
}: {
  status: GitFileStatus;
  original: ImageSide;
  modified: ImageSide;
  fileName: string;
}) {
  if (status === 'added') {
    return (
      <div className="flex h-full flex-col">
        <ImagePane label="Added" side={modified} fileName={fileName} />
      </div>
    );
  }
  if (status === 'deleted') {
    return (
      <div className="flex h-full flex-col">
        <ImagePane label="Deleted" side={original} fileName={fileName} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-row divide-x divide-border">
      <ImagePane label="Before" side={original} fileName={fileName} />
      <ImagePane label="After" side={modified} fileName={fileName} />
    </div>
  );
}
