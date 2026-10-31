'use client';

import { useParams } from 'next/navigation';
import { TerminalLinkPage } from '@/components/terminal/terminal-link-page';
import { decodeSessionId } from '@/components/terminal/terminal-link';

export default function TerminalLinkRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <TerminalLinkPage sessionId={decodeSessionId(sessionId)} />;
}
