'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { commentScopeKey, type CommentScopeInput } from '@/lib/comment-feedback';
import { useOnEventsConnect, useOnServerEvent } from '@/contexts/events-context';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { useOpenTerminals } from '@/components/terminal/terminal-session-store';
import { resolveTerminalLabel } from '@/components/terminal/terminal-label';

interface SendOptions {
  markdown?: string;
  filePath?: string;
  threadIds?: string[];
}

const NO_TERMINAL = 'No active terminal. Open or focus a terminal, then try again.';

function sentMessage(sent: number): string {
  return `Sent ${sent} new comment${sent === 1 ? '' : 's'} to the terminal`;
}

/**
 * Sends a comment scope's unsent comments to the focused terminal, and turns
 * live mode on or off for the scope. A null scope disables both.
 */
export function useCommentDelivery(scope: CommentScopeInput | null) {
  const { resolveTargetSession, terminalActive } = useSendToTerminal();
  const openTerminals = useOpenTerminals();

  const liveQuery = trpc.comment.liveTarget.useQuery(scope ?? { documentPath: '-' }, {
    enabled: !!scope,
  });
  const liveSessionId = liveQuery.data?.sessionId ?? null;
  const refetchLive = liveQuery.refetch;

  // A server restart drops every live pin without a broadcast.
  useOnEventsConnect(() => {
    if (scope) refetchLive();
  });

  useOnServerEvent('COMMENT_LIVE_CHANGE', (payload) => {
    if (!scope || payload.scopeKey !== commentScopeKey(scope)) return;
    refetchLive();
    if (payload.reason === 'session-ended') {
      toast.info('Live comments turned off: the pinned terminal session ended');
    }
  });

  const sendMutation = trpc.comment.sendPending.useMutation({
    onSuccess: ({ sent }) => {
      if (sent === 0) toast.info('No new comments to send');
      else toast.success(sentMessage(sent));
    },
    onError: (err) => toast.error('Failed to send comments', { description: err.message }),
  });

  const liveMutation = trpc.comment.setLive.useMutation({
    onSuccess: () => refetchLive(),
    onError: (err) => toast.error('Failed to change live mode', { description: err.message }),
  });

  const send = useCallback(
    (opts: SendOptions = {}) => {
      if (!scope) return;
      const sessionId = resolveTargetSession();
      if (!sessionId) {
        toast.error(NO_TERMINAL);
        return;
      }
      sendMutation.mutate({ scope, sessionId, ...opts });
    },
    [scope, resolveTargetSession, sendMutation],
  );

  const toggleLive = useCallback(
    (filePath?: string) => {
      if (!scope) return;
      if (liveSessionId) {
        liveMutation.mutate({ scope, sessionId: null });
        return;
      }
      const sessionId = resolveTargetSession();
      if (!sessionId) {
        toast.error(NO_TERMINAL);
        return;
      }
      liveMutation.mutate({ scope, sessionId, filePath });
    },
    [scope, liveSessionId, resolveTargetSession, liveMutation],
  );

  const liveTab = openTerminals.find((tab) => tab.sessionId === liveSessionId);
  const liveLabel = liveTab ? resolveTerminalLabel(liveTab.scope, liveTab.oscTitle) : null;

  return {
    send,
    isSending: sendMutation.isPending,
    terminalActive,
    liveSessionId,
    liveLabel,
    toggleLive,
    isTogglingLive: liveMutation.isPending,
  };
}
