"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiAddLine,
  RiFullscreenLine,
  RiSubtractLine,
  RiRefreshLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { zoomToPoint } from "./zoom-pan-math";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.1;

interface ZoomPanProps {
  children: React.ReactNode;
  className?: string;
  onFullscreen?: () => void;
  showFullscreen?: boolean;
}

export function ZoomPan({ children, className, onFullscreen, showFullscreen }: ZoomPanProps) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Keep refs in sync so the wheel event handler always reads fresh values
  // without re-attaching the listener on every state change.
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  useEffect(() => {
    transformRef.current = { scale, tx, ty };
  }, [scale, tx, ty]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Wheel-to-zoom toward cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const { scale: s, tx: t, ty: u } = transformRef.current;
      const result = zoomToPoint(s, t, u, factor, px, py, MIN_SCALE, MAX_SCALE);
      setScale(result.scale);
      setTx(result.tx);
      setTy(result.ty);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // intentionally empty — reads live values via transformRef

  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    setDragging(true);
    lastPointer.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setTx((t) => t + dx);
    setTy((t) => t + dy);
  };

  const onPointerUp = () => {
    isDragging.current = false;
    setDragging(false);
  };

  const zoomAroundCenter = useCallback(
    (factor: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const { scale: s, tx: t, ty: u } = transformRef.current;
      const result = zoomToPoint(s, t, u, factor, width / 2, height / 2, MIN_SCALE, MAX_SCALE);
      setScale(result.scale);
      setTx(result.tx);
      setTy(result.ty);
    },
    [], // reads live values via transformRef
  );

  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  const pct = `${Math.round(scale * 100)}%`;

  return (
    <div className={cn('relative', className)} contentEditable={false}>
      {/* Viewport */}
      <div
        ref={viewportRef}
        className={cn(
          'relative overflow-hidden w-full h-full',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {children}
        </div>
      </div>

      {/* Control bar overlay — stop pointer propagation so drags on controls don't pan */}
      <div
        className="absolute top-2 right-2 z-10 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm border border-border px-1 py-0.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            zoomAroundCenter(1 / ZOOM_FACTOR);
          }}
          aria-label="Zoom out"
        >
          <RiSubtractLine className="size-3" />
        </Button>

        <button
          type="button"
          className="h-6 min-w-[3.5rem] px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
          aria-label="Reset zoom"
          title="Reset zoom and pan"
        >
          <RiRefreshLine className="size-3 shrink-0" />
          {pct}
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            zoomAroundCenter(ZOOM_FACTOR);
          }}
          aria-label="Zoom in"
        >
          <RiAddLine className="size-3" />
        </Button>

        {showFullscreen && onFullscreen && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation();
              onFullscreen();
            }}
            aria-label="Fullscreen"
          >
            <RiFullscreenLine className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
