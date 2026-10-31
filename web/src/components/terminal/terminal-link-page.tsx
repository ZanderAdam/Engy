'use client';

import { useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { buildTerminalPageUrl } from './terminal-link';

function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function TerminalLinkPage({ sessionId }: { sessionId: string | null }) {
  const { replace } = useVirtualNavigate();
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
    if (sessionId && target && !isFetching) replace(buildTerminalPageUrl(target, sessionId));
  }, [target, sessionId, isFetching, replace]);

  if (!sessionId || (isSuccess && !isFetching && !target)) {
    return (
      <Message
        title="Terminal not found"
        detail="No live terminal or saved history for this id."
      />
    );
  }

  if (isError) {
    return (
      <Message
        title="Could not look up this terminal"
        detail="Check the server connection and open the link again."
      />
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center py-20 text-xs text-muted-foreground">
      Opening terminal...
    </div>
  );
}
