"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ITheme } from "@xterm/xterm";
import { DARK_XTERM_THEME } from "@/hooks/use-xterm-theme";
import { RiArrowDownSLine } from "@remixicon/react";
import type { TerminalTab } from "./types";

export interface TerminalActions {
  write: (data: string) => void;
  kill: () => void;
}

interface TerminalProps {
  tab: TerminalTab;
  xtermTheme?: ITheme;
  onStatusChange: (sessionId: string, status: TerminalTab['status']) => void;
  onReady?: (sessionId: string, actions: TerminalActions | null) => void;
}

function getWsBase(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function buildWsUrl(tab: TerminalTab): string {
  const base = getWsBase();
  const { sessionId, scope } = tab;
  const params = new URLSearchParams({
    sessionId,
    workingDir: scope.workingDir,
    scopeType: scope.scopeType,
    scopeLabel: scope.scopeLabel,
    groupKey: scope.groupKey,
    cols: '80',
    rows: '24',
  });
  if (scope.command) params.set('command', scope.command);
  if (scope.workspaceSlug) params.set('workspaceSlug', scope.workspaceSlug);
  if (scope.containerMode) params.set('containerMode', scope.containerMode);
  return `${base}/ws/terminal?${params.toString()}`;
}

export function TerminalInstance({ tab, xtermTheme, onStatusChange, onReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isPinnedRef = useRef(true);
  const scrollRafRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const sessionId = tab.sessionId;

  const handleScrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
    isPinnedRef.current = true;
    setShowScrollButton(false);
  }, []);

  const handleResize = useCallback(() => {
    fitAddonRef.current?.fit();
    const term = xtermRef.current;
    const ws = wsRef.current;
    if (term && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'resize', sessionId, cols: term.cols, rows: term.rows }));
    }
  }, [sessionId]);

  useEffect(() => {
    if (!containerRef.current) return;

    let isCleanedUp = false;

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      theme: xtermTheme ?? DARK_XTERM_THEME,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    const fitTimer = setTimeout(() => { if (!isCleanedUp) fitAddon.fit(); }, 50);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    isPinnedRef.current = true;
    setShowScrollButton(false);

    const scrollSub = term.onScroll(() => {
      const buf = term.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      isPinnedRef.current = atBottom;
      setShowScrollButton(!atBottom);
    });

    const scheduleScroll = () => {
      if (!scrollRafRef.current) {
        scrollRafRef.current = requestAnimationFrame(() => {
          scrollRafRef.current = 0;
          if (isPinnedRef.current) {
            term.scrollToBottom();
          }
        });
      }
    };

    const ws = new WebSocket(buildWsUrl(tab));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[terminal-ui] WS open for session ${sessionId}`);
      onStatusChange(sessionId, 'active');
      ws.send(JSON.stringify({ t: 'resize', sessionId, cols: term.cols, rows: term.rows }));
      onReady?.(sessionId, {
        write: (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'i', sessionId, d: data }));
          }
        },
        kill: () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'kill', sessionId }));
          }
        },
      });
    };

    ws.onmessage = (event) => {
      let msg: { t: string; d?: string; buffer?: string[]; exitCode?: number };
      try {
        msg = JSON.parse(event.data as string) as typeof msg;
      } catch {
        return;
      }

      if (msg.t === 'o' && msg.d) {
        const wasPinned = isPinnedRef.current;
        term.write(msg.d);
        if (wasPinned) scheduleScroll();
      } else if (msg.t === 'reconnected' && msg.buffer) {
        console.log(`[terminal-ui] Reconnected session ${sessionId}, buffer lines: ${msg.buffer.length}`);
        term.clear();
        term.write(msg.buffer.join(''), () => {
          term.scrollToBottom();
        });
        isPinnedRef.current = true;
        setShowScrollButton(false);
      } else if (msg.t === 'exit') {
        const code = msg.exitCode ?? 0;
        console.log(`[terminal-ui] Exit for session ${sessionId}: code=${code}`);
        onStatusChange(sessionId, 'exited');
        const label =
          code === -1
            ? 'Session expired (disconnected too long)'
            : code === 0
              ? 'Process exited'
              : `Process exited with code ${code}`;
        term.write(`\r\n\x1b[2m[${label}]\x1b[0m\r\n`);
        if (isPinnedRef.current) scheduleScroll();
      } else if (msg.t === 'error') {
        console.error(`[terminal-ui] Error for session ${sessionId}: no daemon`);
        onStatusChange(sessionId, 'error');
        term.write('\r\n\x1b[31m[Error: no daemon connected]\x1b[0m\r\n');
        if (isPinnedRef.current) scheduleScroll();
      }
    };

    ws.onclose = (event) => {
      console.log(`[terminal-ui] WS closed for session ${sessionId}: code=${event.code} reason=${event.reason}`);
    };

    ws.onerror = (event) => {
      if (isCleanedUp) return;
      const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
      console.error(
        `[terminal-ui] WS error for session ${sessionId}: ` +
          `state=${readyStates[ws.readyState]} url=${ws.url}`,
        event,
      );
    };

    // Intercept Shift+Enter to send shell line continuation
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown' && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'i', sessionId, d: '\\\r' }));
        }
        return false;
      }
      return true;
    });

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'i', sessionId, d: data }));
      }
    });

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      isCleanedUp = true;
      clearTimeout(fitTimer);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
      scrollSub.dispose();
      resizeObserver.disconnect();
      onReady?.(sessionId, null);
      ws.close();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
    // Intentionally only depends on sessionId and handleResize — do NOT add tab or scope
    // to avoid reconnecting when props change. sessionId is stable per tab lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, handleResize]);

  useEffect(() => {
    if (xtermRef.current && xtermTheme) {
      xtermRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" />
      {showScrollButton && (
        <button
          onClick={handleScrollToBottom}
          className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-700/80 px-3 py-1 text-xs text-zinc-300 shadow-lg backdrop-blur-sm transition-opacity hover:bg-zinc-600/80"
          aria-label="Scroll to bottom"
        >
          <RiArrowDownSLine className="size-3.5" />
          Bottom
        </button>
      )}
    </div>
  );
}
