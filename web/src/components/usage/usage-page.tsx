'use client';

import { useCallback, useMemo, useState } from 'react';
import { RiBarChartBoxLine, RiRefreshLine } from '@remixicon/react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { useVirtualNavigate, useVirtualSearchParams } from '@/components/tabs/tab-context';
import { Button } from '@/components/ui/button';
import { BurnScreen } from './burn-screen';
import { DateRangePicker } from './date-range-picker';
import { parseRange, previousWindowLabel, type DateRange } from './date-range';
import { OverviewScreen } from './overview-screen';
import { SessionDetail } from './session-detail';
import { SessionsScreen } from './sessions-screen';
import type { FileGroupBy, GroupAxis, UsageView } from './types';

const VIEWS: Array<{ id: UsageView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'burn', label: "What's burning it" },
  { id: 'sessions', label: 'Sessions' },
];

const ROW_LIMIT = 100;
const SESSION_LIMIT = 200;

function isView(value: string | null): value is UsageView {
  return value === 'overview' || value === 'burn' || value === 'sessions';
}

interface UsagePageProps {
  workspaceSlug: string;
  projectSlug?: string;
}

export function UsagePage({ workspaceSlug, projectSlug }: UsagePageProps) {
  const nav = useVirtualNavigate();
  const searchParams = useVirtualSearchParams();
  const utils = trpc.useUtils();

  const now = useMemo(() => new Date(), []);
  const range = parseRange(searchParams, now);
  const viewParam = searchParams.get('view');
  const view: UsageView = isView(viewParam) ? viewParam : 'overview';
  const selectedSession = searchParams.get('session');

  const [groupAxis, setGroupAxis] = useState<GroupAxis>('repo');
  const [fileGroupBy, setFileGroupBy] = useState<FileGroupBy>('path');
  const [includeSubagents, setIncludeSubagents] = useState(false);

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

  const basePath = projectSlug
    ? `/w/${workspaceSlug}/projects/${projectSlug}/usage`
    : `/w/${workspaceSlug}/usage`;

  const pushState = useCallback(
    (next: { range?: DateRange; view?: UsageView; session?: string | null }) => {
      const params = new URLSearchParams();
      const effectiveRange = next.range ?? range;
      params.set('from', effectiveRange.from);
      params.set('to', effectiveRange.to);
      const effectiveView = next.view ?? view;
      if (effectiveView !== 'overview') params.set('view', effectiveView);
      const effectiveSession = next.session === undefined ? selectedSession : next.session;
      if (effectiveSession) params.set('session', effectiveSession);
      nav.push(`${basePath}?${params.toString()}`);
    },
    [basePath, nav, range, selectedSession, view],
  );

  const workspaceId = workspace?.id;
  const projectId = projectSlug ? project?.id : undefined;
  const scopeReady = !!workspace && (!projectSlug || !!project);
  const rangeInput = { workspaceId, projectId, from: range.from, to: range.to };

  const overviewQuery = trpc.usage.overview.useQuery(
    { ...rangeInput, groupBy: groupAxis },
    { enabled: scopeReady && view === 'overview' },
  );

  const sessionsQuery = trpc.usage.sessions.useQuery(
    { ...rangeInput, limit: SESSION_LIMIT, sort: 'cost', includeSubagents },
    { enabled: scopeReady && (view === 'overview' || view === 'sessions') },
  );

  const toolsQuery = trpc.usage.tools.useQuery(
    { ...rangeInput, limit: ROW_LIMIT },
    { enabled: scopeReady && view === 'burn' },
  );
  const fieldsQuery = trpc.usage.fields.useQuery(
    { ...rangeInput, limit: ROW_LIMIT },
    { enabled: scopeReady && view === 'burn' },
  );
  const filesQuery = trpc.usage.files.useQuery(
    { ...rangeInput, limit: ROW_LIMIT, groupBy: fileGroupBy },
    { enabled: scopeReady && view === 'burn' },
  );

  const sessionQuery = trpc.usage.session.useQuery(
    { sessionId: selectedSession ?? '' },
    { enabled: !!selectedSession },
  );

  const refreshMutation = trpc.usage.refresh.useMutation({
    onSuccess: (result) => {
      utils.usage.invalidate();
      toast.success(
        `Scanned ${result.scannedFiles} transcripts in ${(result.durationMs / 1000).toFixed(1)}s`,
        { description: `${result.newSessions} new sessions` },
      );
    },
    onError: (error) => toast.error('Usage scan failed', { description: error.message }),
  });

  const previousLabel = previousWindowLabel(range, now);

  function selectSession(sessionId: string) {
    pushState({ view: 'sessions', session: sessionId });
  }

  const isLoading =
    overviewQuery.isLoading ||
    sessionsQuery.isLoading ||
    toolsQuery.isLoading ||
    fieldsQuery.isLoading ||
    filesQuery.isLoading;

  function renderBody() {
    if (selectedSession) {
      if (!sessionQuery.data) {
        return <p className="py-20 text-center text-xs text-muted-foreground">Loading…</p>;
      }
      return (
        <SessionDetail detail={sessionQuery.data} onBack={() => pushState({ session: null })} />
      );
    }

    if (view === 'burn') {
      return (
        <BurnScreen
          tools={toolsQuery.data ?? []}
          fields={fieldsQuery.data ?? []}
          files={filesQuery.data ?? []}
          fileGroupBy={fileGroupBy}
          onFileGroupByChange={setFileGroupBy}
        />
      );
    }

    if (view === 'sessions') {
      return (
        <SessionsScreen
          sessions={sessionsQuery.data ?? []}
          includeSubagents={includeSubagents}
          onIncludeSubagentsChange={setIncludeSubagents}
          onSelect={selectSession}
        />
      );
    }

    if (!overviewQuery.data) {
      return (
        <p className="py-20 text-center text-xs text-muted-foreground">
          {isLoading ? 'Loading…' : 'No usage data yet — run a scan to populate this range.'}
        </p>
      );
    }

    return (
      <OverviewScreen
        overview={overviewQuery.data}
        sessions={sessionsQuery.data ?? []}
        groupAxis={groupAxis}
        onGroupAxisChange={setGroupAxis}
        previousLabel={previousLabel}
        onSelectSession={selectSession}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border py-2">
        <div className="flex items-center gap-2">
          <RiBarChartBoxLine className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Usage</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            range={range}
            now={now}
            onChange={(next) => pushState({ range: next })}
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RiRefreshLine className={cn('size-3', refreshMutation.isPending && 'animate-spin')} />
            {refreshMutation.isPending ? 'Scanning…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => pushState({ view: item.id, session: null })}
            className={cn(
              'relative cursor-pointer whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
              view === item.id &&
                'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">{renderBody()}</div>
    </div>
  );
}
