import type { NodeShape } from './flow-model';

/**
 * Tiny inline SVG glyph for each node shape, used in the palette and the shape
 * picker. Drawn in a 24×16 box with currentColor so it inherits button styling.
 */
export function ShapeIcon({ shape, className }: { shape: NodeShape; className?: string }) {
  const stroke = 'currentColor';
  const common = { fill: 'none', stroke, strokeWidth: 1.5 } as const;
  return (
    <svg viewBox="0 0 24 16" className={className} width="24" height="16" aria-hidden>
      {shape === 'rectangle' && <rect x="2" y="3" width="20" height="10" {...common} />}
      {shape === 'rounded' && <rect x="2" y="3" width="20" height="10" rx="3" {...common} />}
      {shape === 'stadium' && <rect x="2" y="3" width="20" height="10" rx="5" {...common} />}
      {shape === 'subroutine' && (
        <>
          <rect x="2" y="3" width="20" height="10" {...common} />
          <line x1="5" y1="3" x2="5" y2="13" {...common} />
          <line x1="19" y1="3" x2="19" y2="13" {...common} />
        </>
      )}
      {shape === 'cylinder' && (
        <>
          <path d="M3 4 v8 a9 2 0 0 0 18 0 v-8" {...common} />
          <ellipse cx="12" cy="4" rx="9" ry="2" {...common} />
        </>
      )}
      {shape === 'circle' && <circle cx="12" cy="8" r="6" {...common} />}
      {shape === 'rhombus' && <path d="M12 2 L22 8 L12 14 L2 8 Z" {...common} />}
      {shape === 'hexagon' && <path d="M6 3 H18 L22 8 L18 13 H6 L2 8 Z" {...common} />}
      {shape === 'parallelogram' && <path d="M6 3 H22 L18 13 H2 Z" {...common} />}
    </svg>
  );
}
