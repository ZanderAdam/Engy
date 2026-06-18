'use client';

import { type NodeShape, SHAPE_LABELS, PALETTE_SHAPES } from './flow-model';
import { ShapeIcon } from './shape-icon';

interface ShapePaletteProps {
  onAddNode: (shape: NodeShape) => void;
}

/** Vertical palette of shapes; clicking adds a standalone node of that shape. */
export function ShapePalette({ onAddNode }: ShapePaletteProps) {
  return (
    <div
      className="absolute top-2 right-2 z-20 flex flex-col gap-0.5 bg-popover/90 backdrop-blur-sm border border-border p-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {PALETTE_SHAPES.map((shape) => (
        <button
          key={shape}
          type="button"
          onClick={() => onAddNode(shape)}
          title={`Add ${SHAPE_LABELS[shape]}`}
          aria-label={`Add ${SHAPE_LABELS[shape]}`}
          className="flex items-center justify-center p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ShapeIcon shape={shape} />
        </button>
      ))}
    </div>
  );
}
