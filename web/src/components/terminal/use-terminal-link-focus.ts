'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import {
  useTabId,
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { requestTerminalFocus } from './focus-confirmation';
import { decideTerminalLinkAction, TERMINAL_PARAM, type TerminalDock } from './terminal-link';
import type { TerminalDropdownGroup } from './types';

interface TerminalLinkFocusOptions {
  ready: boolean;
  resumeGroup: TerminalDropdownGroup | undefined;
  resumeGroupReady: boolean;
  onReveal: (dock: TerminalDock) => void;
}

const CLOSED_TOAST_MS = 15_000;

export function useTerminalLinkFocus({
  ready,
  resumeGroup,
  resumeGroupReady,
  onReveal,
}: TerminalLinkFocusOptions): void {
  const tabId = useTabId();
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const { replace } = useVirtualNavigate();
  const sessionId = searchParams.get(TERMINAL_PARAM);
  const handledRef = useRef<string | null>(null);

  const {
    data: target,
    isSuccess,
    isError,
    isFetching,
  } = trpc.terminal.resolveLink.useQuery(
    { sessionId: sessionId ?? '' },
    { enabled: !!sessionId, staleTime: 0 },
  );

  useEffect(() => {
    if (!sessionId) handledRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !ready || isFetching || !(isSuccess || isError)) return;

    const action = isError
      ? ({ kind: 'lookup-failed' } as const)
      : decideTerminalLinkAction({ target, sessionId, resumeGroup, resumeGroupReady });
    if (action.kind === 'wait') return;

    if (handledRef.current === sessionId) return;
    handledRef.current = sessionId;

    const rest = new URLSearchParams(searchParams);
    rest.delete(TERMINAL_PARAM);
    const query = rest.toString();
    replace(query ? `${pathname}?${query}` : pathname);

    const tabDetail = tabId ? { tabId } : {};

    switch (action.kind) {
      case 'lookup-failed':
        toast.error('Could not look up this terminal. Check the server connection and try again.');
        return;
      case 'not-found':
        toast.error('No live terminal or saved history for this id.');
        return;
      case 'closed': {
        const { resumeScope } = action;
        toast('This terminal is closed.', {
          duration: CLOSED_TOAST_MS,
          action: resumeScope
            ? {
                label: 'Resume',
                onClick: () => {
                  onReveal('terminal');
                  window.dispatchEvent(
                    new CustomEvent('terminal:open', { detail: { scope: resumeScope, ...tabDetail } }),
                  );
                },
              }
            : undefined,
        });
        return;
      }
      case 'focus':
        onReveal(action.dock);
        window.dispatchEvent(
          new CustomEvent('terminal:reveal', {
            detail: { sessionId, dock: action.dock, ...tabDetail },
          }),
        );
        requestTerminalFocus({
          sessionId,
          tabId,
          dock: action.dock,
          onMissing: () =>
            toast.error('This terminal exists, but this view does not list it. Open its project.'),
        });
        return;
    }
  }, [
    sessionId,
    ready,
    isSuccess,
    isError,
    isFetching,
    target,
    tabId,
    resumeGroup,
    resumeGroupReady,
    onReveal,
    pathname,
    searchParams,
    replace,
  ]);
}
