'use client';

import dynamic from 'next/dynamic';

export const DynamicMonacoDiffEditor = dynamic(
  () => import('./monaco-diff-editor').then((mod) => mod.MonacoDiffEditor),
  { ssr: false },
);

export const DynamicMonacoCodeEditor = dynamic(
  () => import('./monaco-code-editor').then((mod) => mod.MonacoCodeEditor),
  { ssr: false },
);
