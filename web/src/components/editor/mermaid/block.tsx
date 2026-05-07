"use client";

import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { RiPencilLine, RiFlowChart } from "@remixicon/react";
import { MermaidPreview } from "./preview";
import { MermaidEditDialog } from "./edit-dialog";
import { Button } from "@/components/ui/button";

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
            <button
              type="button"
              className="block w-full text-left cursor-pointer"
              onClick={() => isEditable && setOpen(true)}
              aria-label="Edit mermaid diagram"
            >
              <MermaidPreview code={code} blockId={block.id} className="max-h-96" />
            </button>
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
          {isEditable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 h-6 px-2 text-xs opacity-0 group-hover/mermaid:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
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
        </div>
      );
    },
  },
);
