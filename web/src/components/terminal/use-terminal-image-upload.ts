'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { terminalImageError } from '@/lib/terminal-image';

export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export function useTerminalImageUpload(sessionId: string, onUploaded: (path: string) => void) {
  const { mutateAsync, isPending } = trpc.terminal.uploadImage.useMutation();

  const upload = useCallback(
    async (file: File) => {
      const error = terminalImageError(file.type, file.size);
      if (error) {
        toast.error(error);
        return;
      }
      try {
        const base64 = await readFileAsBase64(file);
        const { path } = await mutateAsync({ sessionId, mimeType: file.type, base64 });
        onUploaded(path);
      } catch (err) {
        toast.error(`Image upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [sessionId, mutateAsync, onUploaded],
  );

  return { upload, uploading: isPending };
}
