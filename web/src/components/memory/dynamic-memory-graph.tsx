'use client';

import dynamic from 'next/dynamic';

// react-force-graph-3d touches window/document at module load (three.js/WebGL),
// so it must never run during SSR.
export const DynamicMemoryGraph = dynamic(
  () => import('./memory-graph').then((mod) => mod.MemoryGraph),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Loading graph…</p>
      </div>
    ),
  },
);
