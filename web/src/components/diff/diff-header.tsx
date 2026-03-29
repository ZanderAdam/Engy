'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GitFileStatus, ViewMode, EditorMode, DiffViewMode } from './types';
import type { SaveStatus } from './use-auto-save';

const statusConfig: Record<GitFileStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'bg-green-500/15 text-green-500 border-green-500/30' },
  modified: { letter: 'M', className: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  deleted: { letter: 'D', className: 'bg-red-500/15 text-red-500 border-red-500/30' },
  renamed: { letter: 'R', className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
};

const saveStatusLabels: Record<SaveStatus, string | null> = {
  idle: null,
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Save failed',
};

export function DiffHeader({
  filePath,
  status,
  viewMode,
  onViewModeChange,
  editorMode,
  onEditorModeChange,
  diffViewMode,
  saveStatus,
}: {
  filePath: string;
  status: GitFileStatus;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  editorMode?: EditorMode;
  onEditorModeChange?: (mode: EditorMode) => void;
  diffViewMode?: DiffViewMode;
  saveStatus?: SaveStatus;
}) {
  const { letter, className } = statusConfig[status];
  const showEditToggle = diffViewMode === 'latest' && onEditorModeChange;
  const saveLabel = saveStatus ? saveStatusLabels[saveStatus] : null;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <span
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center border text-[10px] font-bold',
          className,
        )}
      >
        {letter}
      </span>

      <span className="truncate font-mono text-xs text-foreground">{filePath}</span>

      <div className="ml-auto flex items-center gap-2">
        {saveLabel && (
          <span
            className={cn(
              'text-[10px]',
              saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {saveLabel}
          </span>
        )}

        {showEditToggle && (
          <div className="flex">
            <Button
              variant="ghost"
              size="xs"
              className={cn(editorMode === 'diff' && 'bg-muted text-foreground')}
              onClick={() => onEditorModeChange('diff')}
            >
              Diff
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className={cn(editorMode === 'edit' && 'bg-muted text-foreground')}
              onClick={() => onEditorModeChange('edit')}
            >
              Edit
            </Button>
          </div>
        )}

        <div className="flex">
          <Button
            variant="ghost"
            size="xs"
            className={cn(viewMode === 'split' && 'bg-muted text-foreground')}
            onClick={() => onViewModeChange('split')}
          >
            Split
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={cn(viewMode === 'unified' && 'bg-muted text-foreground')}
            onClick={() => onViewModeChange('unified')}
          >
            Unified
          </Button>
        </div>
      </div>
    </div>
  );
}
