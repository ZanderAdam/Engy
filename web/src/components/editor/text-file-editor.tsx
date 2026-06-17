'use client';

import { useEffect, useRef, useState } from 'react';
import { RiDownloadLine, RiFileCopyLine } from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface TextFileEditorProps {
  content: string;
  onSave: (next: string) => void;
  fileName: string;
}

const AUTOSAVE_DEBOUNCE_MS = 600;

/** Editable plain-text viewer for non-markdown text files. */
export function TextFileEditor({ content, onSave, fileName }: TextFileEditorProps) {
  const [value, setValue] = useState(content);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const lastSavedRef = useRef(content);
  const valueRef = useRef(content);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Debounced autosave — never fires the initial content back as a write.
  useEffect(() => {
    if (value === lastSavedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedRef.current = value;
      onSaveRef.current(value);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [value]);

  // Flush pending save on unmount — reads via refs so the effect stays mount-only.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (valueRef.current !== lastSavedRef.current) {
          onSaveRef.current(valueRef.current);
        }
      }
    };
  }, []);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => toast.success('Copied to clipboard'));
  }

  function handleDownload() {
    const blob = new Blob([value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{fileName}</span>
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                >
                  <RiFileCopyLine className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Copy contents</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                >
                  <RiDownloadLine className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Download</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      <textarea
        className="flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
