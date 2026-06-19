'use client';

import type { ReactNode } from 'react';
import { ImagePreview } from './image-preview';
import { TextFileEditor } from './text-file-editor';
import { UnsupportedFilePreview } from './unsupported-file-preview';
import { fileKind } from '@/lib/file-types';

type FileKind = ReturnType<typeof fileKind>;

interface QueryError {
  message: string;
}

interface FileContentPreviewProps {
  kind: FileKind;
  fileName: string;
  image: { isLoading: boolean; error: QueryError | null; dataUri?: string };
  fileLoading: boolean;
  fileError: QueryError | null;
  textContent: string;
  textKey: string;
  onSaveText: (content: string) => void;
  /** Rendered for a loaded markdown file — each call site supplies its own editor. */
  children: ReactNode;
}

function centered(message: string): ReactNode {
  return (
    <div className="flex items-center justify-center py-20">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function failure(title: string, detail: string): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

/**
 * Renders the non-markdown file states (image / binary / loading / error /
 * text) shared by the directory browser and the docs dock; renders `children`
 * (the call site's own document editor) for a loaded markdown file.
 */
export function FileContentPreview({
  kind,
  fileName,
  image,
  fileLoading,
  fileError,
  textContent,
  textKey,
  onSaveText,
  children,
}: FileContentPreviewProps): ReactNode {
  if (kind === 'image') {
    if (image.isLoading) return centered('Loading...');
    if (image.error) return failure('Failed to load image', image.error.message);
    return <ImagePreview dataUri={image.dataUri!} fileName={fileName} />;
  }

  if (kind === 'binary') return <UnsupportedFilePreview fileName={fileName} />;

  if (fileLoading) return centered('Loading...');
  if (fileError) return failure('Failed to load file', fileError.message);

  if (kind === 'text') {
    return <TextFileEditor key={textKey} content={textContent} onSave={onSaveText} fileName={fileName} />;
  }

  return <>{children}</>;
}
