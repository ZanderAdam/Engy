"use client";

import { useCallback, useRef, useState } from "react";
import { RiSideBarLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "./terminal-panel";
import { useTerminalContext } from "./terminal-provider";

interface TerminalShellProps {
  children: React.ReactNode;
}

export function TerminalShell({ children }: TerminalShellProps) {
  const { collapsed, toggleCollapsed } = useTerminalContext();
  const [terminalWidth, setTerminalWidth] = useState(480);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = terminalWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // Terminal is on the right — dragging left widens it
        const newWidth = Math.min(900, Math.max(240, startWidth - (ev.clientX - startX)));
        setTerminalWidth(newWidth);
      };
      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [terminalWidth],
  );

  return (
    <div className="flex min-h-0 flex-1 w-full overflow-hidden">
      {/* Main content — grows to fill remaining space, overflow-hidden clips editor content at panel boundary */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {children}
      </div>

      {/* Boundary strip — same pattern as docs sidebar */}
      <div className="relative shrink-0 flex items-stretch">
        {!collapsed && (
          <div
            className="w-px cursor-col-resize bg-border hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={handleMouseDown}
          />
        )}
        <Button
          variant="outline"
          size="icon"
          className="absolute top-2 -left-3 z-10 h-6 w-6 rounded-full border bg-background shadow-sm"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand terminal (Ctrl+`)" : "Collapse terminal (Ctrl+`)"}
        >
          <RiSideBarLine className="size-3" />
        </Button>
      </div>

      {/* Terminal panel — always mounted to keep WS connections alive */}
      <div
        className="shrink-0 overflow-hidden"
        style={{ width: collapsed ? 0 : terminalWidth }}
      >
        <TerminalPanel />
      </div>
    </div>
  );
}
