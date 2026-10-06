'use client';

import dynamic from 'next/dynamic';

export const MarkdownView = dynamic(() => import('./markdown-view-content'), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
