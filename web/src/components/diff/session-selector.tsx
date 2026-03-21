'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/trpc';

interface SessionSelectorProps {
  selectedSessionId: string | null;
  onSessionChange: (sessionId: string | null) => void;
}

const MAIN_REPO_VALUE = '__main__';

const STATUS_DOTS: Record<string, string> = {
  active: 'bg-green-500',
  completed: 'bg-blue-500',
  paused: 'bg-yellow-500',
  stopped: 'bg-zinc-500',
};

function sessionLabel(session: {
  sessionId: string;
  branch: string | null;
  taskTitle: string | null;
  groupName: string | null;
}): string {
  if (session.branch) return session.branch;
  if (session.taskTitle) return session.taskTitle;
  if (session.groupName) return session.groupName;
  return session.sessionId.slice(0, 8);
}

export function SessionSelector({ selectedSessionId, onSessionChange }: SessionSelectorProps) {
  const { data: sessions } = trpc.diff.getSessions.useQuery({});

  if (!sessions || sessions.length === 0) return null;

  const handleChange = (value: string) => {
    onSessionChange(value === MAIN_REPO_VALUE ? null : value);
  };

  return (
    <div className="px-3 py-2">
      <Select value={selectedSessionId ?? MAIN_REPO_VALUE} onValueChange={handleChange}>
        <SelectTrigger size="sm" className="w-full max-w-[260px]">
          <SelectValue placeholder="Select session" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MAIN_REPO_VALUE}>Main repo</SelectItem>
          {sessions.map((session) => (
            <SelectItem key={session.sessionId} value={session.sessionId}>
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${STATUS_DOTS[session.status] ?? 'bg-zinc-500'}`}
                />
                <span className="truncate">{sessionLabel(session)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
