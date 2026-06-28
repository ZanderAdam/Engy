'use client';

import type { ReactNode } from 'react';
import { ImagePreview } from './image-preview';
import { UnsupportedFilePreview } from './unsupported-file-preview';

interface QueryError {
  message: string;
}

interface NonTextFileViewProps {
  kind: 'image' | 'binary';
  fileName: string;
  /** Image data fetch state — ignored for binary files. */
  image?: { isLoading: boolean; error: QueryError | null; dataUri?: string };
}

function centered(message: string): ReactNode {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Renders the non-text file states (image preview / binary placeholder) shared
 * by the code viewer, the diff viewer, and the docs dock. Text and markdown are
 * each surface's own concern; this only covers what they render identically.
 */
export function NonTextFileView({ kind, fileName, image }: NonTextFileViewProps): ReactNode {
  if (kind === 'binary') return <UnsupportedFilePreview fileName={fileName} />;

  if (!image || image.isLoading) return centered('Loading...');
  if (image.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm font-medium">Failed to load image</p>
        <p className="text-xs text-muted-foreground">{image.error.message}</p>
      </div>
    );
  }
  if (!image.dataUri) return centered('No image data');
  return <ImagePreview dataUri={image.dataUri} fileName={fileName} />;
}
