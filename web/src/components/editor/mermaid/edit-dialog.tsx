"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MermaidPreview } from "./preview";

interface MermaidEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  initialCode: string;
  /** Called whenever the source changes (already debounced internally). */
  onChange: (code: string) => void;
}

const WRITE_BACK_DEBOUNCE_MS = 300;

interface DialogBodyProps {
  blockId: string;
  initialCode: string;
  onChange: (code: string) => void;
  onClose: () => void;
}

/**
 * Inner body of the edit dialog. Mounted fresh every time the dialog opens
 * (via conditional rendering on `open`), so initial state is taken straight
 * from `initialCode` without needing a sync-from-props effect.
 */
function DialogBody({ blockId, initialCode, onChange, onClose }: DialogBodyProps) {
  const [source, setSource] = useState(initialCode);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Debounced write-back so the inline preview updates as the user types.
  useEffect(() => {
    if (source === initialCode) return;
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      onChangeRef.current(source);
    }, WRITE_BACK_DEBOUNCE_MS);
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, [source, initialCode]);

  // Flush any pending write on unmount (i.e. when dialog closes).
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
    };
  }, []);

  const handleCloseFlush = () => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (source !== initialCode) {
      onChangeRef.current(source);
    }
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col md:flex-row"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          handleCloseFlush();
          onClose();
        }
      }}
    >
      <div className="flex-1 min-h-0 min-w-0 border-b md:border-b-0 md:border-r border-border">
        <Textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          className="w-full h-full resize-none border-0 rounded-none font-mono text-xs leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="flowchart TD&#10;  A --> B"
          autoFocus
        />
      </div>
      <div className="flex-1 min-h-0 min-w-0 bg-muted/30">
        <MermaidPreview code={source} blockId={blockId} className="h-full" />
      </div>
    </div>
  );
}

export function MermaidEditDialog({
  open,
  onOpenChange,
  blockId,
  initialCode,
  onChange,
}: MermaidEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 sm:max-w-[95vw] flex flex-col gap-0 ring-1">
        <DialogTitle className="sr-only">Edit Mermaid diagram</DialogTitle>
        <DialogDescription className="sr-only">
          Edit the diagram source on the left; the rendered preview updates on the right.
        </DialogDescription>
        {open && (
          <DialogBody
            blockId={blockId}
            initialCode={initialCode}
            onChange={onChange}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
