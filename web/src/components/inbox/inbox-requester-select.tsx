'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ANY_REQUESTER, VIEWER_REQUESTER } from './inbox-helpers';

interface InboxRequesterSelectProps {
  value: string;
  teams: string[];
  onChange: (value: string) => void;
}

export function InboxRequesterSelect({ value, teams, onChange }: InboxRequesterSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label="Requested from" className="h-7 min-w-0 max-w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_REQUESTER}>From anyone</SelectItem>
        <SelectItem value={VIEWER_REQUESTER}>From me</SelectItem>
        {teams.length > 0 && <SelectSeparator />}
        {teams.map((team) => (
          <SelectItem key={team} value={team}>
            {team}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
