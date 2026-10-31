'use client';

import { useState } from 'react';
import { RiArrowRightSLine } from '@remixicon/react';
import { CollapsedLaneRail } from '@/components/projects/task-views/collapsed-lane-rail';
import { CollapsedLaneStrip } from '@/components/projects/task-views/collapsed-lane-strip';
import { laneCollapsed } from '@/components/projects/task-views/kanban-collapse';
import { KanbanLaneContent } from '@/components/projects/task-views/kanban-lane-content';
import {
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useProjectTerminals } from '@/hooks/use-project-terminals';
import { trpc } from '@/lib/trpc';
import { AttentionBadge } from './attention-badge';
import { normalizeWtParam, worktreeFromGroupKey } from './group-key';
import { sessionToTab, type SessionListItem } from './session-to-tab';
import {
  groupTerminalsByLane,
  TERMINAL_LANE_DOT_COLORS,
  TERMINAL_LANE_LABELS,
  TERMINAL_LANES,
  type TerminalLane,
} from './terminal-board-model';
import { resolveTerminalLabel } from './terminal-label';
import { useSendToTerminal } from './use-send-to-terminal';

const MOBILE_LANE_PRIORITY: TerminalLane[] = ['waiting', 'active', 'done', 'idle', 'backlog'];

function TerminalBoardCard({
  session,
  onOpen,
}: {
  session: SessionListItem;
  onOpen: (session: SessionListItem) => void;
}) {
  const tab = sessionToTab(session, '');
  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      className="flex shrink-0 flex-col gap-0.5 border border-border p-2 text-left hover:bg-muted/50"
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs">
          {resolveTerminalLabel(tab.scope, tab.oscTitle)}
        </span>
        <AttentionBadge needsAttention={session.needsAttention} />
      </span>
      {session.worktreeBranch && (
        <span className="truncate text-[10px] text-muted-foreground">
          {session.worktreeBranch}
        </span>
      )}
    </button>
  );
}

function TerminalLaneColumn({
  lane,
  sessions,
  onOpen,
  onCollapse,
  fixedHeight = false,
}: {
  lane: TerminalLane;
  sessions: SessionListItem[];
  onOpen: (session: SessionListItem) => void;
  onCollapse?: () => void;
  fixedHeight?: boolean;
}) {
  return (
    <div className={`flex min-h-0 flex-col gap-2 bg-background p-3${fixedHeight ? ' h-48' : ''}`}>
      <KanbanLaneContent
        dotColorClass={TERMINAL_LANE_DOT_COLORS[lane]}
        label={TERMINAL_LANE_LABELS[lane]}
        count={sessions.length}
        remeasureKey={sessions.length}
        headerAction={
          onCollapse && (
            <button
              type="button"
              aria-label={`Collapse ${TERMINAL_LANE_LABELS[lane]}`}
              onClick={onCollapse}
              className="ml-auto text-muted-foreground/60 hover:text-muted-foreground"
            >
              <RiArrowRightSLine className="size-4 rotate-180" />
            </button>
          )
        }
      >
        {sessions.map((session) => (
          <TerminalBoardCard key={session.sessionId} session={session} onOpen={onOpen} />
        ))}
        {sessions.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No terminals</p>
        )}
      </KanbanLaneContent>
    </div>
  );
}

function useOpenBoardTerminal(workspaceSlug: string) {
  const nav = useVirtualNavigate();
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const { focusTerminal } = useSendToTerminal();
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });

  return (session: SessionListItem) => {
    const worktree = worktreeFromGroupKey(session.groupKey);
    const inCurrentDock =
      workspace?.combinedWorktrees || worktree === normalizeWtParam(searchParams.get('wt'));
    if (!inCurrentDock) {
      const params = new URLSearchParams(searchParams);
      if (worktree) params.set('wt', worktree);
      else params.delete('wt');
      const query = params.toString();
      nav.push(query ? `${pathname}?${query}` : pathname);
      return;
    }
    focusTerminal(session.sessionId);
  };
}

export function TerminalBoard({
  workspaceSlug,
  projectSlug,
}: {
  workspaceSlug: string;
  projectSlug: string;
}) {
  const isMobile = useIsMobile();
  const sessions = useProjectTerminals(workspaceSlug, projectSlug);
  const openTerminal = useOpenBoardTerminal(workspaceSlug);
  const [collapseOverrides, setCollapseOverrides] = useState<
    Partial<Record<TerminalLane, boolean>>
  >({});
  const [expandedLane, setExpandedLane] = useState<TerminalLane | null>(null);

  if (!sessions || sessions.length === 0) return null;

  const lanes = groupTerminalsByLane(sessions);
  const onlyBacklog = lanes.backlog.length === sessions.length;
  const collapsedWith = (lane: TerminalLane, override: boolean | undefined) => {
    if (override === undefined && onlyBacklog && lane === 'backlog') return false;
    return laneCollapsed(lane, lanes[lane].length, override, true);
  };
  const isCollapsed = (lane: TerminalLane) => collapsedWith(lane, collapseOverrides[lane]);
  const toggleLane = (lane: TerminalLane) =>
    setCollapseOverrides((prev) => ({ ...prev, [lane]: !collapsedWith(lane, prev[lane]) }));
  const mobileLane =
    expandedLane ?? MOBILE_LANE_PRIORITY.find((lane) => lanes[lane].length > 0) ?? 'idle';

  return (
    <section aria-label="Terminals" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold">Terminals</h3>
      {isMobile ? (
        <div className="flex flex-col gap-px border border-border bg-border">
          {TERMINAL_LANES.map((lane) =>
            lane === mobileLane ? (
              <TerminalLaneColumn
                key={lane}
                lane={lane}
                sessions={lanes[lane]}
                onOpen={openTerminal}
                fixedHeight
              />
            ) : (
              <CollapsedLaneStrip
                key={lane}
                label={TERMINAL_LANE_LABELS[lane]}
                count={lanes[lane].length}
                dotColorClass={TERMINAL_LANE_DOT_COLORS[lane]}
                onExpand={() => setExpandedLane(lane)}
              />
            ),
          )}
        </div>
      ) : (
        <div
          className="grid h-56 gap-px border border-border bg-border"
          style={{
            gridTemplateColumns: TERMINAL_LANES.map((lane) =>
              isCollapsed(lane) ? 'auto' : 'minmax(0, 1fr)',
            ).join(' '),
          }}
        >
          {TERMINAL_LANES.map((lane) =>
            isCollapsed(lane) ? (
              <CollapsedLaneRail
                key={lane}
                label={TERMINAL_LANE_LABELS[lane]}
                count={lanes[lane].length}
                onExpand={() => toggleLane(lane)}
              />
            ) : (
              <TerminalLaneColumn
                key={lane}
                lane={lane}
                sessions={lanes[lane]}
                onOpen={openTerminal}
                onCollapse={() => toggleLane(lane)}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}
