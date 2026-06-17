"use client";

import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { RiPencilLine, RiFlowChart } from "@remixicon/react";
import { MermaidPreview } from "./preview";
import { MermaidEditDialog } from "./edit-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export const mermaidBlockSpec = createReactBlockSpec(
  {
    type: "mermaid" as const,
    propSchema: {
      ...defaultProps,
      code: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (block as any).props.code as string;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [open, setOpen] = useState(false);
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [fsOpen, setFsOpen] = useState(false);

      const handleChange = (next: string) => {
        editor.updateBlock(block, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          props: { code: next } as any,
        });
      };

      const isEditable = editor.isEditable;
      const hasCode = code.trim() !== "";

      return (
        <div
          className="relative w-full my-1 group/mermaid border border-border rounded-none bg-muted/20"
          contentEditable={false}
        >
          {hasCode ? (
            <MermaidPreview
              code={code}
              blockId={block.id}
              className="max-h-96"
              interactive
              showFullscreen
              onFullscreen={() => setFsOpen(true)}
            />
          ) : (
            <button
              type="button"
              className="flex w-full flex-col items-center justify-center gap-2 py-12 text-muted-foreground hover:bg-muted/40 cursor-pointer"
              onClick={() => isEditable && setOpen(true)}
            >
              <RiFlowChart className="size-6" />
              <span className="text-xs">Click to edit diagram</span>
            </button>
          )}

          {/* Edit button — offset right when diagram is shown to avoid overlapping the zoom controls */}
          {isEditable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "absolute top-2 h-6 px-2 text-xs opacity-0 group-hover/mermaid:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm",
                hasCode ? "right-28" : "right-2",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
            >
              <RiPencilLine className="size-3 mr-1" />
              Edit
            </Button>
          )}

          {isEditable && (
            <MermaidEditDialog
              open={open}
              onOpenChange={setOpen}
              blockId={block.id}
              initialCode={code}
              onChange={handleChange}
            />
          )}

          {/* Fullscreen read-only viewer */}
          <Dialog open={fsOpen} onOpenChange={setFsOpen}>
            <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] p-0 sm:max-w-[95vw] flex flex-col gap-0 ring-1">
              <DialogTitle className="sr-only">Mermaid diagram fullscreen</DialogTitle>
              <DialogDescription className="sr-only">
                Fullscreen read-only view of the mermaid diagram. Use scroll and drag to pan and zoom.
              </DialogDescription>
              {fsOpen && (
                <MermaidPreview
                  code={code}
                  blockId={`${block.id}-fs`}
                  className="h-full"
                  interactive
                />
              )}
            </DialogContent>
          </Dialog>
        </div>
      );
    },
  },
);
