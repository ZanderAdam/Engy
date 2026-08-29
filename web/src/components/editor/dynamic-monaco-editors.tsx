'use client';

import dynamic from 'next/dynamic';

export const DynamicMonacoCodeEditor = dynamic(
  () => import('./monaco-code-editor').then((mod) => mod.MonacoCodeEditor),
  { ssr: false },
);
