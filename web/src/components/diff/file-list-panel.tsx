'use client';

import { useMemo, useState } from 'react';
import { RiLoopLeftLine, RiFolderLine, RiSearchLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChangedFile, GitFileStatus } from '@/components/diff/types';

interface FileListPanelProps {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

const STATUS_COLORS: Record<GitFileStatus, string> = {
  added: 'text-green-500',
  modified: 'text-blue-500',
  deleted: 'text-red-500',
  renamed: 'text-yellow-500',
};

const STATUS_LABELS: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

interface DirGroup {
  dir: string;
  files: ChangedFile[];
}

function groupByDirectory(files: ChangedFile[]): DirGroup[] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const groups = new Map<string, ChangedFile[]>();

  for (const file of sorted) {
    const parts = file.path.split('/');
    parts.pop();
    const dir = parts.join('/');
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(file);
  }

  return [...groups.entries()].map(([dir, dirFiles]) => ({ dir, files: dirFiles }));
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

interface DirGroupViewProps {
  group: DirGroup;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

function DirGroupView({ group, selectedFile, onSelectFile }: DirGroupViewProps) {
  return (
    <div>
      {group.dir && (
        <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">
          <RiFolderLine className="size-3 shrink-0" />
          <span className="truncate">{group.dir}</span>
        </div>
      )}
      {group.files.map((file) => {
        const isSelected = selectedFile === file.path;
        return (
          <button
            key={file.path}
            className={cn(
              'flex w-full items-center gap-1.5 py-1 text-left text-xs hover:bg-accent/50',
              group.dir ? 'pl-4 pr-2' : 'px-2',
              isSelected && 'bg-accent text-accent-foreground',
            )}
            onClick={() => onSelectFile(file.path)}
          >
            <span className={cn('shrink-0 font-mono text-[10px]', STATUS_COLORS[file.status])}>
              {STATUS_LABELS[file.status]}
            </span>
            <span className="truncate">{getFileName(file.path)}</span>
          </button>
        );
      })}
    </div>
  );
}

interface FileGroupsProps {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

function FileGroups({ files, selectedFile, onSelectFile }: FileGroupsProps) {
  const hasStagedAndUnstaged =
    files.some((f) => f.staged) && files.some((f) => !f.staged);

  if (!hasStagedAndUnstaged) {
    return (
      <>
        {groupByDirectory(files).map((group) => (
          <DirGroupView
            key={group.dir}
            group={group}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
          />
        ))}
      </>
    );
  }

  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);

  return (
    <>
      <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Staged
      </div>
      {groupByDirectory(staged).map((group) => (
        <DirGroupView
          key={`staged-${group.dir}`}
          group={group}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      ))}
      <div className="px-2 pt-3 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Unstaged
      </div>
      {groupByDirectory(unstaged).map((group) => (
        <DirGroupView
          key={`unstaged-${group.dir}`}
          group={group}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      ))}
    </>
  );
}

export function FileListPanel({
  files,
  selectedFile,
  onSelectFile,
  onRefresh,
  isLoading,
}: FileListPanelProps) {
  const [filter, setFilter] = useState('');

  const filteredFiles = useMemo(() => {
    if (!filter) return files;
    const q = filter.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, filter]);

  const statusCounts = useMemo(() => {
    const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const file of files) {
      counts[file.status]++;
    }
    return counts;
  }, [files]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {files.length} file{files.length !== 1 ? 's' : ''} changed
          </span>
          {statusCounts.added > 0 && (
            <span className="text-xs text-green-500">+{statusCounts.added}</span>
          )}
          {statusCounts.modified > 0 && (
            <span className="text-xs text-blue-500">~{statusCounts.modified}</span>
          )}
          {statusCounts.deleted > 0 && (
            <span className="text-xs text-red-500">-{statusCounts.deleted}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="h-6 w-6 p-0"
        >
          <RiLoopLeftLine className={cn('size-3.5', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {files.length > 5 && (
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
          <RiSearchLine className="size-3 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>
      )}

      {filteredFiles.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">No changes detected</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto py-1">
          <FileGroups
            files={filteredFiles}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
          />
        </div>
      )}
    </div>
  );
}
