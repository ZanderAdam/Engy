'use client';

import { useEffect, useRef, useState } from 'react';
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiRobotLine,
  RiSendPlaneLine,
  RiStopLine,
  RiToolsLine,
  RiUserLine,
} from '@remixicon/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  id?: string;
  is_error?: boolean;
}

interface SessionEntry {
  type?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  [key: string]: unknown;
}

interface ExecutionTabProps {
  scope: 'task' | 'taskGroup' | 'milestone';
  scopeId: number | string;
  sessionId: string;
  status: string | null;
  completionSummary?: string | null;
}

// ── Polling interval ──────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;

// ── Component ─────────────────────────────────────────────────────────

export function ExecutionTab({ scope, scopeId, sessionId, status, completionSummary }: ExecutionTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const isActive = status === 'active';
  const isSubmitted = status === 'submitted';

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.execution.getSessionFile.useQuery(
    { sessionId },
    { enabled: !isSubmitted, refetchInterval: isActive ? POLL_INTERVAL_MS : false },
  );

  const retryMutation = trpc.execution.retryExecution.useMutation({
    onSuccess: () => {
      utils.execution.getSessionStatus.invalidate({ scope, id: scopeId });
    },
    onError: (err) => {
      toast.error('Failed to retry execution', { description: err.message });
      utils.execution.getSessionStatus.invalidate({ scope, id: scopeId });
    },
  });

  const stopMutation = trpc.execution.stopExecution.useMutation({
    onSuccess: () => {
      utils.execution.getSessionStatus.invalidate({ scope, id: scopeId });
    },
  });

  const entries = (data?.entries ?? []) as SessionEntry[];

  useEffect(() => {
    if (shouldAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, shouldAutoScroll]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShouldAutoScroll(isNearBottom);
  }

  const isFailed = status === 'stopped' || status === 'failed';
  const failedToStart = isFailed && entries.length === 0 && !!completionSummary;
  const isTerminal = status === 'completed' || status === 'stopped' || status === 'failed';

  return (
    <div className="flex flex-col gap-2">
      <SessionHeader sessionId={sessionId} status={status} entryCount={entries.length} />

      {isSubmitted ? (
        <div className="flex flex-col gap-2 rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {completionSummary ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-foreground">
              {completionSummary}
            </pre>
          ) : (
            <span>Remote session submitted</span>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => stopMutation.mutate({ sessionId })}
              disabled={stopMutation.isPending}
            >
              <RiStopLine className="size-3" />
              Stop
            </Button>
          )}
          {isFailed && !failedToStart && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => retryMutation.mutate({ sessionId })}
              disabled={retryMutation.isPending}
            >
              <RiRefreshLine className="size-3" />
              Retry
            </Button>
          )}
        </div>
      )}

      {!isSubmitted && (
        <div
          ref={scrollRef}
          className="max-h-[50vh] overflow-auto border border-border"
          onScroll={handleScroll}
        >
          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <RiLoader4Line className="mr-2 size-4 animate-spin" />
              Loading session...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              {isActive ? (
                <>
                  <RiLoader4Line className="mr-2 size-4 animate-spin" />
                  Waiting for output...
                </>
              ) : completionSummary ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex items-center gap-2 text-destructive">
                    <RiErrorWarningLine className="size-4" />
                    <span className="text-sm font-medium">Execution failed to start</span>
                  </div>
                  <pre className="max-w-md whitespace-pre-wrap break-words text-xs">
                    {completionSummary}
                  </pre>
                </div>
              ) : (
                'No session entries'
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-px p-2">
              {entries.map((entry, i) => (
                <EntryRenderer key={i} entry={entry} />
              ))}
              {isActive && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <RiLoader4Line className="size-3 animate-spin" />
                  Agent is working...
                </div>
              )}
              {isFailed && completionSummary && (
                <div className="flex items-center gap-2 border-l-2 border-destructive/40 px-3 py-2">
                  <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />
                  <pre className="whitespace-pre-wrap break-words text-xs text-destructive">
                    {completionSummary}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isTerminal && scope === 'task' && entries.length > 0 && (
        <FollowUpComposer sessionId={sessionId} scope={scope} scopeId={scopeId} />
      )}
    </div>
  );
}

// ── Follow-up composer ────────────────────────────────────────────────

function FollowUpComposer({
  sessionId,
  scope,
  scopeId,
}: {
  sessionId: string;
  scope: 'task' | 'taskGroup' | 'milestone';
  scopeId: number | string;
}) {
  const [prompt, setPrompt] = useState('');
  const utils = trpc.useUtils();

  const sendMutation = trpc.execution.sendFeedback.useMutation({
    onSuccess: () => {
      setPrompt('');
      utils.execution.getSessionStatus.invalidate({ scope, id: scopeId });
    },
    onError: (err) => {
      toast.error('Failed to send follow-up', { description: err.message });
      utils.execution.getSessionStatus.invalidate({ scope, id: scopeId });
    },
  });

  function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate({ sessionId, feedback: trimmed });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border bg-muted/30 p-2">
      <Textarea
        aria-label="Follow-up prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a follow-up to resume this session… (Cmd/Ctrl+Enter to send)"
        rows={3}
        className="resize-none border-border bg-background"
        disabled={sendMutation.isPending}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={handleSubmit}
          disabled={!prompt.trim() || sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            <RiLoader4Line className="size-3 animate-spin" />
          ) : (
            <RiSendPlaneLine className="size-3" />
          )}
          Send
        </Button>
      </div>
    </div>
  );
}

// ── Session header ────────────────────────────────────────────────────

function SessionHeader({
  sessionId,
  status,
  entryCount,
}: {
  sessionId: string;
  status: string | null;
  entryCount: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <StatusBadge status={status} />
      <span className="text-muted-foreground font-mono">{sessionId.slice(0, 8)}</span>
      <span className="text-muted-foreground">{entryCount} entries</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const variants: Record<string, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; label: string; icon?: React.ReactNode }> = {
    active: {
      variant: 'default',
      label: 'Running',
      icon: <RiLoader4Line className="size-3 animate-spin" />,
    },
    completed: { variant: 'secondary', label: 'Completed' },
    submitted: { variant: 'outline', label: 'Remote' },
    stopped: { variant: 'destructive', label: 'Stopped' },
    failed: { variant: 'destructive', label: 'Failed' },
  };

  const config = variants[status] ?? { variant: 'outline' as const, label: status };

  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}

// ── Entry renderer ────────────────────────────────────────────────────

function EntryRenderer({ entry }: { entry: SessionEntry }) {
  const role = entry.type ?? entry.message?.role;

  if (role === 'user') return <UserEntry entry={entry} />;
  if (role === 'assistant') return <AssistantEntry entry={entry} />;

  return null;
}

function UserEntry({ entry }: { entry: SessionEntry }) {
  const content = extractTextContent(entry.message?.content);
  if (!content) return null;

  return (
    <div className="flex gap-2 border-l-2 border-blue-500/40 px-3 py-2">
      <RiUserLine className="mt-0.5 size-3 shrink-0 text-blue-500" />
      <pre className="whitespace-pre-wrap break-words text-xs text-foreground">{content}</pre>
    </div>
  );
}

function AssistantEntry({ entry }: { entry: SessionEntry }) {
  const content = entry.message?.content;

  if (typeof content === 'string') {
    return (
      <div className="flex gap-2 border-l-2 border-emerald-500/40 px-3 py-2">
        <RiRobotLine className="mt-0.5 size-3 shrink-0 text-emerald-500" />
        <pre className="whitespace-pre-wrap break-words text-xs text-foreground">{content}</pre>
      </div>
    );
  }

  if (!Array.isArray(content)) return null;

  const blocks = content as ContentBlock[];

  return (
    <div className="flex flex-col gap-1">
      {blocks.map((block, i) => {
        if (block.type === 'text' && block.text) {
          return (
            <div key={i} className="flex gap-2 border-l-2 border-emerald-500/40 px-3 py-2">
              <RiRobotLine className="mt-0.5 size-3 shrink-0 text-emerald-500" />
              <pre className="whitespace-pre-wrap break-words text-xs text-foreground">
                {block.text}
              </pre>
            </div>
          );
        }
        if (block.type === 'tool_use') {
          return <ToolUseBlock key={i} block={block} />;
        }
        if (block.type === 'tool_result') {
          return <ToolResultBlock key={i} block={block} />;
        }
        return null;
      })}
    </div>
  );
}

// ── Tool blocks ───────────────────────────────────────────────────────

function ToolUseBlock({ block }: { block: ContentBlock }) {
  const [open, setOpen] = useState(false);
  const inputStr = block.input ? JSON.stringify(block.input, null, 2) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 border-l-2 border-amber-500/40 px-3 py-1.5',
            'text-xs text-muted-foreground hover:bg-muted/50 transition-colors',
          )}
        >
          <RiToolsLine className="size-3 shrink-0 text-amber-500" />
          <span className="font-mono font-medium text-foreground">{block.name}</span>
          {open ? (
            <RiArrowDownSLine className="ml-auto size-3" />
          ) : (
            <RiArrowRightSLine className="ml-auto size-3" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {inputStr && (
          <div className="ml-5 border-l border-border bg-muted/30 px-3 py-2">
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
              Input
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {inputStr}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatContent(content: unknown): string | null {
  if (!content) return null;
  if (typeof content === 'string') return content;
  return JSON.stringify(content, null, 2);
}

function ToolResultBlock({ block }: { block: ContentBlock }) {
  const [open, setOpen] = useState(false);
  const contentStr = formatContent(block.content);

  if (!contentStr) return null;

  const isError = block.is_error === true;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1 ml-5',
            'text-[11px] text-muted-foreground hover:bg-muted/50 transition-colors',
            isError && 'text-red-400',
          )}
        >
          {isError && <RiErrorWarningLine className="size-3 shrink-0 text-red-400" />}
          <span className="truncate font-mono">{isError ? 'Error' : 'Result'}</span>
          {open ? (
            <RiArrowDownSLine className="ml-auto size-3" />
          ) : (
            <RiArrowRightSLine className="ml-auto size-3" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className={cn(
            'ml-5 border-l px-3 py-2',
            isError ? 'border-red-500/40 bg-red-500/5' : 'border-border bg-muted/30',
          )}
        >
          <pre
            className={cn(
              'overflow-x-auto whitespace-pre-wrap break-words text-[11px]',
              isError ? 'text-red-400' : 'text-muted-foreground',
            )}
          >
            {contentStr}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractTextContent(content: string | ContentBlock[] | undefined): string | null {
  if (!content) return null;
  if (typeof content === 'string') return content;
  const textBlocks = content.filter((b) => b.type === 'text' && b.text);
  return textBlocks.map((b) => b.text).join('\n') || null;
}
