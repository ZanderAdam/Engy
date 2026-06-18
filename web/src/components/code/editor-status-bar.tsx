'use client';

import { cn } from '@/lib/utils';
import type { CursorPosition } from '@/components/editor/monaco-code-editor';

interface EditorStatusBarProps {
  language: string;
  cursor: CursorPosition | null;
  wordWrap: boolean;
  minimap: boolean;
  onToggleWordWrap: () => void;
  onToggleMinimap: () => void;
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-sm px-1.5 py-0.5 hover:bg-accent hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
    </button>
  );
}

export function EditorStatusBar({
  language,
  cursor,
  wordWrap,
  minimap,
  onToggleWordWrap,
  onToggleMinimap,
}: EditorStatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-background px-3 py-1 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        {cursor && (
          <span className="font-mono">
            Ln {cursor.line}, Col {cursor.column}
          </span>
        )}
        <span className="uppercase tracking-wide">{language}</span>
      </div>
      <div className="flex items-center gap-1">
        <Toggle label="Wrap" active={wordWrap} onClick={onToggleWordWrap} />
        <Toggle label="Minimap" active={minimap} onClick={onToggleMinimap} />
      </div>
    </div>
  );
}
