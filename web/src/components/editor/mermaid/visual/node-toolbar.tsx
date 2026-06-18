'use client';

import { useRef } from 'react';
import { RiFileCopyLine, RiDeleteBin6Line, RiShapeLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { type FlowNode, type NodeShape, SHAPE_LABELS, PALETTE_SHAPES } from './flow-model';
import { ShapeIcon } from './shape-icon';

interface NodeToolbarProps {
  node: FlowNode;
  /** Container-relative pixel position of the toolbar's anchor (top-center of node). */
  left: number;
  top: number;
  onRename: (label: string) => void;
  onShapeChange: (shape: NodeShape) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function NodeToolbar({
  node,
  left,
  top,
  onRename,
  onShapeChange,
  onDuplicate,
  onDelete,
}: NodeToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Uncontrolled field so typing never re-renders the canvas. `key={node.label}`
  // remounts it when the label changes externally (e.g. edited in the code pane),
  // keeping it in sync without a setState-in-effect.
  const commit = () => {
    const value = inputRef.current?.value ?? '';
    if (value !== node.label) onRename(value);
  };

  return (
    <div
      className="absolute z-20 -translate-x-1/2 -translate-y-full flex items-center gap-0.5 bg-popover border border-border shadow-md px-1 py-1"
      style={{ left, top: top - 8 }}
      // Keep gestures on the toolbar from reaching the canvas (pan/deselect).
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        key={node.label}
        ref={inputRef}
        defaultValue={node.label}
        onBlur={commit}
        onKeyDown={(e) => {
          // Keep Enter/Escape/Delete from reaching the canvas or closing the dialog.
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            inputRef.current?.blur();
          }
          if (e.key === 'Escape' && inputRef.current) {
            inputRef.current.value = node.label;
            inputRef.current.blur();
          }
        }}
        placeholder="Label"
        className="h-6 w-32 bg-input/40 border border-input px-1.5 text-xs outline-none focus:border-ring"
        aria-label="Node label"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Change shape">
            <RiShapeLine className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="grid grid-cols-3 gap-0.5 p-1">
          {PALETTE_SHAPES.map((shape) => (
            <DropdownMenuItem
              key={shape}
              onSelect={() => onShapeChange(shape)}
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-1.5 cursor-pointer',
                shape === node.shape && 'bg-muted',
              )}
              title={SHAPE_LABELS[shape]}
            >
              <ShapeIcon shape={shape} />
              <span className="text-[9px] text-muted-foreground">{SHAPE_LABELS[shape]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="ghost" size="icon-xs" onClick={onDuplicate} aria-label="Duplicate node">
        <RiFileCopyLine className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label="Delete node"
        className="text-destructive hover:text-destructive"
      >
        <RiDeleteBin6Line className="size-3" />
      </Button>
    </div>
  );
}
