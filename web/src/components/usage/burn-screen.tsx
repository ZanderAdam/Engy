'use client';

import { cn } from '@/lib/utils';
import { ExpensiveCallsTable } from './expensive-calls-table';
import { FieldTable } from './field-table';
import { FileTable } from './file-table';
import { EstimateNotice, TabbedPanel } from './panel';
import { ToolTable } from './tool-table';
import type {
  FileGroupBy,
  UsageExpensiveCallRow,
  UsageFieldRow,
  UsageFileRow,
  UsageToolRow,
} from './types';

interface BurnScreenProps {
  tools: UsageToolRow[];
  fields: UsageFieldRow[];
  files: UsageFileRow[];
  expensiveCalls: UsageExpensiveCallRow[];
  fileGroupBy: FileGroupBy;
  onFileGroupByChange: (groupBy: FileGroupBy) => void;
  onSelectSession: (sessionId: string) => void;
}

const FILE_GROUPS: Array<{ value: FileGroupBy; label: string }> = [
  { value: 'path', label: 'Path' },
  { value: 'ext', label: 'Extension' },
  { value: 'dir', label: 'Directory' },
];

function GroupToggle({
  value,
  onChange,
}: {
  value: FileGroupBy;
  onChange: (value: FileGroupBy) => void;
}) {
  return (
    <div className="flex items-center border border-border">
      {FILE_GROUPS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'cursor-pointer px-2 py-0.5 text-xs transition-colors',
            value === option.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function BurnScreen({
  tools,
  fields,
  files,
  expensiveCalls,
  fileGroupBy,
  onFileGroupByChange,
  onSelectSession,
}: BurnScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <EstimateNotice> Per-tool costs are estimates, not measurements.</EstimateNotice>

      <TabbedPanel
        tabs={[
          { value: 'tools', label: 'Tools', content: <ToolTable rows={tools} /> },
          { value: 'fields', label: 'Tool input fields', content: <FieldTable rows={fields} /> },
          {
            value: 'files',
            label: 'Files',
            action: <GroupToggle value={fileGroupBy} onChange={onFileGroupByChange} />,
            content: <FileTable rows={files} groupBy={fileGroupBy} />,
          },
          {
            value: 'calls',
            label: 'Highest cost calls',
            content: (
              <ExpensiveCallsTable rows={expensiveCalls} onSelectSession={onSelectSession} />
            ),
          },
        ]}
      />
    </div>
  );
}
