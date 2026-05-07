"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { renderDiagram, type MermaidTheme } from "./render";
import { cn } from "@/lib/utils";

interface MermaidPreviewProps {
  code: string;
  blockId: string;
  className?: string;
  /** Debounce delay in ms before rendering after `code` changes. */
  debounceMs?: number;
}

export function MermaidPreview({
  code,
  blockId,
  className,
  debounceMs = 300,
}: MermaidPreviewProps) {
  const { resolvedTheme } = useTheme();
  const theme: MermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default';

  // Last-good SVG is kept in state so the previous diagram remains visible
  // through transient parse errors (FR 6). Accessing via state (not refs)
  // satisfies the react-hooks/refs rule and keeps renders pure.
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const result = await renderDiagram(blockId, code, theme);
      if ('svg' in result) {
        setSvg(result.svg);
        setError(null);
      } else {
        // Keep last-good SVG visible (do not clear `svg`); only surface error.
        setError(result.error);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [code, theme, blockId, debounceMs]);

  const hasContent = svg !== '';
  const displaySvg = svg;

  return (
    <div
      className={cn(
        'w-full min-h-24 overflow-auto p-4',
        className,
      )}
      contentEditable={false}
    >
      {hasContent ? (
        <div
          className="mermaid-svg-host w-full [&>svg]:block [&>svg]:mx-auto [&>svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: displaySvg }}
        />
      ) : (
        !error && (
          <div className="text-xs text-muted-foreground text-center">Rendering...</div>
        )
      )}
      {error && (
        <div className="mt-2 text-xs text-destructive font-mono whitespace-pre-wrap">
          {error}
        </div>
      )}
    </div>
  );
}
