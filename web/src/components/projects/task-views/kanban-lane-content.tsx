'use client';

import { useEffect, useRef, useState } from 'react';

export function KanbanLaneContent({
  dotColorClass,
  label,
  count,
  remeasureKey,
  headerAction,
  children,
}: {
  dotColorClass: string;
  label: string;
  count: number;
  remeasureKey: string | number;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function updateOverflow() {
      if (!el) return;
      const top = el.scrollTop > 0;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setOverflow({ top, bottom });
    }

    updateOverflow();
    el.addEventListener('scroll', updateOverflow);

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(el);

    return () => {
      el.removeEventListener('scroll', updateOverflow);
      observer.disconnect();
    };
  }, [remeasureKey]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColorClass}`} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground/60">{count}</span>
        {headerAction}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {children}
        </div>
        {overflow.top && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background to-transparent"
          />
        )}
        {overflow.bottom && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
    </>
  );
}
