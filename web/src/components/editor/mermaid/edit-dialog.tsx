"use client";

import { useEffect, useRef, useState } from "react";
import { RiFlowChart, RiCodeSSlashLine } from "@remixicon/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MermaidPreview } from "./preview";
import { detectDiagramType } from "./visual/parse";
import { MermaidVisualEditor } from "./visual/visual-editor";

interface MermaidEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  initialCode: string;
  /** Called whenever the source changes (already debounced internally). */
  onChange: (code: string) => void;
}

const WRITE_BACK_DEBOUNCE_MS = 300;

type EditMode = "visual" | "code";

interface DialogBodyProps {
  blockId: string;
  initialCode: string;
  onChange: (code: string) => void;
  /** Pointed at the visual editor's Escape-dismiss handler (picker/selection). */
  dismissRef: { current: (() => boolean) | null };
}

/**
 * Inner body of the edit dialog. Mounted fresh every time the dialog opens
 * (via conditional rendering on `open`), so initial state is taken straight
 * from `initialCode` without needing a sync-from-props effect.
 */
function DialogBody({ blockId, initialCode, onChange, dismissRef }: DialogBodyProps) {
  const [source, setSource] = useState(initialCode);
  const canVisual = detectDiagramType(source) === "flowchart";
  const [mode, setMode] = useState<EditMode>(
    detectDiagramType(initialCode) === "flowchart" ? "visual" : "code",
  );
  const effectiveMode: EditMode = canVisual ? mode : "code";

  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  const sourceRef = useRef(source);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  // Debounced write-back so the inline block preview updates as the user edits.
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

  // Flush any pending write on unmount — covers every close path (button,
  // overlay click, or Escape captured by the Radix dialog), not just our own.
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      if (sourceRef.current !== initialCode) onChangeRef.current(sourceRef.current);
    };
  }, [initialCode]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant={effectiveMode === "visual" ? "secondary" : "ghost"}
            size="xs"
            disabled={!canVisual}
            onClick={() => setMode("visual")}
            title={canVisual ? "Visual editor" : "Visual editing is available for flowcharts"}
          >
            <RiFlowChart className="size-3" />
            Visual
          </Button>
          <Button
            type="button"
            variant={effectiveMode === "code" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setMode("code")}
          >
            <RiCodeSSlashLine className="size-3" />
            Code
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {effectiveMode === "visual"
            ? "Drag the handles around a node to connect or create; select a node to edit it."
            : canVisual
              ? "Editing source — switch to Visual to edit on a canvas."
              : "Visual editing supports flowcharts; this diagram type is edited as code."}
        </span>
      </div>

      <div className="flex-1 min-h-0">
        {effectiveMode === "visual" ? (
          <MermaidVisualEditor code={source} onCodeChange={setSource} dismissRef={dismissRef} />
        ) : (
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            <div className="flex-1 min-h-0 min-w-0 border-b md:border-b-0 md:border-r border-border">
              <Textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
                className={cn(
                  "w-full h-full resize-none border-0 rounded-none font-mono text-xs leading-relaxed",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                )}
                placeholder="flowchart TD&#10;  A --> B"
                autoFocus
              />
            </div>
            <div className="flex-1 min-h-0 min-w-0 bg-muted/30">
              <MermaidPreview code={source} blockId={blockId} className="h-full" interactive />
            </div>
          </div>
        )}
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
  // Lets the visual editor consume Escape (close picker/selection) before the
  // dialog itself closes.
  const dismissRef = useRef<(() => boolean) | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[98vw] w-[98vw] h-[95vh] p-0 sm:max-w-[98vw] flex flex-col gap-0 ring-1"
        onEscapeKeyDown={(e) => {
          if (dismissRef.current?.()) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Edit Mermaid diagram</DialogTitle>
        <DialogDescription className="sr-only">
          Edit the diagram visually on a canvas or as mermaid source code.
        </DialogDescription>
        {open && (
          <DialogBody
            blockId={blockId}
            initialCode={initialCode}
            onChange={onChange}
            dismissRef={dismissRef}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
