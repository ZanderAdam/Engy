'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EstimateNotice, Panel } from './panel';
import { SessionsTable } from './sessions-table';
import type { UsageSessionRow } from './types';

interface SessionsScreenProps {
  sessions: UsageSessionRow[];
  includeSubagents: boolean;
  onIncludeSubagentsChange: (include: boolean) => void;
  onSelect: (sessionId: string) => void;
}

export function SessionsScreen({
  sessions,
  includeSubagents,
  onIncludeSubagentsChange,
  onSelect,
}: SessionsScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <EstimateNotice> A session&apos;s cost includes the subagents it spawned.</EstimateNotice>

      <Panel
        title="Sessions"
        action={
          <div className="flex items-center gap-2">
            <Switch
              id="include-subagents"
              size="sm"
              checked={includeSubagents}
              onCheckedChange={onIncludeSubagentsChange}
            />
            <Label htmlFor="include-subagents" className="text-xs text-muted-foreground">
              List subagent runs
            </Label>
          </div>
        }
      >
        <SessionsTable rows={sessions} onSelect={onSelect} />
      </Panel>
    </div>
  );
}
