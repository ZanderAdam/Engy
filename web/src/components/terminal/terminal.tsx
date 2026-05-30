"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { ITheme } from "@xterm/xterm";
import type { DockviewPanelApi } from "dockview";
import { DARK_XTERM_THEME } from "@/hooks/use-xterm-theme";
import { RiArrowDownSLine } from "@remixicon/react";
import type { ActivityEvent, TerminalTab } from "./types";
import { parseTerminalActivity } from "./parse-terminal-activity";
import { createActivityTracker } from "./activity-tracker";
import { ReconnectingSocket } from "./reconnecting-socket";
import { MobileTerminalControls } from "./mobile-terminal-controls";
import { shouldSendResize } from "./terminal-resize";
import { useIsMobile } from "@/hooks/use-mobile";

export interface TerminalActions {
  write: (data: string) => void;
  kill: () => void;
}

interface TerminalProps {
  tab: TerminalTab;
  xtermTheme?: ITheme;
  onStatusChange: (sessionId: string, status: TerminalTab['status']) => void;
  onReady?: (sessionId: string, actions: TerminalActions | null) => void;
  onActivity?: (sessionId: string, event: ActivityEvent) => void;
  panelApi?: DockviewPanelApi;
}

const ACTIVITY_DEBOUNCE_MS = 3000;
const TITLE_SUPPRESS_MS = 3000;

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
  if (scope.taskId != null) params.set('taskId', String(scope.taskId));
  return `${base}/ws/terminal?${params.toString()}`;
}

export function TerminalInstance({ tab, xtermTheme, onStatusChange, onReady, onActivity, panelApi }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReconnectingSocket | null>(null);
  const isPinnedRef = useRef(true);
  const scrollRafRef = useRef(0);
  const lastSentColsRef = useRef(0);
  const lastSentRowsRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const sessionId = tab.sessionId;
  const isMobile = useIsMobile();

  const sendKey = useCallback(
    (data: string) => {
      socketRef.current?.send(JSON.stringify({ t: 'i', sessionId, d: data }));
    },
    [sessionId],
  );

  const handleScrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
    isPinnedRef.current = true;
    setShowScrollButton(false);
  }, []);

  const fitAndSyncResize = useCallback(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const term = xtermRef.current;
    if (!container || !fitAddon || !term) return;

    // Skip when panel is hidden (display:none gives 0 dimensions)
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

    fitAddon.fit();

    // Only send resize to server when dimensions actually changed
    if (!shouldSendResize(term.cols, term.rows, lastSentColsRef.current, lastSentRowsRef.current)) return;
    lastSentColsRef.current = term.cols;
    lastSentRowsRef.current = term.rows;

    socketRef.current?.send(JSON.stringify({ t: 'resize', sessionId, cols: term.cols, rows: term.rows }));
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

    // Activity detection via OSC title changes and PTY output bytes parsed from
    // raw WebSocket data. This works even when the terminal tab is hidden
    // (display:none), unlike xterm's onTitleChange which defers processing.
    let lastTitle = '';
    const activityTracker = createActivityTracker({
      debounceMs: ACTIVITY_DEBOUNCE_MS,
      suppressMs: TITLE_SUPPRESS_MS,
      onActivity: (event: ActivityEvent) => onActivity?.(sessionId, event),
    });

    const handleTitleChange = (title: string) => {
      if (title === lastTitle) return;
      lastTitle = title;
      activityTracker.bumpActivity();
    };

    const scrollSub = term.onScroll(() => {
      const buf = term.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      setShowScrollButton(!atBottom);
      // Only unpin — never re-pin from onScroll. xterm's write() can trigger
      // scroll events that would incorrectly re-pin when the user scrolled up.
      if (!atBottom) {
        isPinnedRef.current = false;
      }
    });

    // Handle scroll intent via wheel events. xterm's own wheel handler fires
    // first (on the descendant viewport element), so by the time our handler
    // runs, isPinnedRef reflects whether xterm already scrolled a full line.
    const container = containerRef.current;
    const handleWheel = (e: WheelEvent) => {
      // When scrolling towards scrollback while pinned, force one-line scroll
      // to escape the auto-scroll zone. Without this, scrollToBottom() and
      // xterm's write-triggered auto-scroll reset the native scrollbar every
      // frame, preventing small trackpad deltas from accumulating.
      if (isPinnedRef.current && e.deltaY < 0 && term.buffer.active.baseY > 0) {
        term.scrollLines(-1);
      }

      // Re-pin when user scrolls to the bottom
      requestAnimationFrame(() => {
        const t = xtermRef.current;
        if (!t) return;
        const buf = t.buffer.active;
        if (buf.viewportY >= buf.baseY) {
          isPinnedRef.current = true;
          setShowScrollButton(false);
        }
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: true });
    // focusin bubbles from xterm's textarea (unlike focus), so any click/keyboard
    // focus re-syncs PTY size when the viewport changed while the panel was hidden.
    container.addEventListener('focusin', fitAndSyncResize);

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

    const actions: TerminalActions = {
      write: (data) => socketRef.current?.send(JSON.stringify({ t: 'i', sessionId, d: data })),
      kill: () => socketRef.current?.send(JSON.stringify({ t: 'kill', sessionId })),
    };

    const socket = new ReconnectingSocket({
      urlFactory: () => buildWsUrl(tab),
      callbacks: {
        onOpen: () => {
          console.log(`[terminal-ui] WS open for session ${sessionId}`);
          onStatusChange(sessionId, 'active');
          // Reset the last-sent guard so every (re)connect re-asserts real, post-fit
          // dimensions. The PTY may have (re)spawned at the URL default (80x24), and
          // these refs persist across socket reconnects — without the reset a matching
          // guard could suppress the resize and leave the PTY stuck at the stale size.
          lastSentColsRef.current = 0;
          lastSentRowsRef.current = 0;
          fitAndSyncResize();
        },
        onMessage: (event) => {
          let msg: { t: string; d?: string; buffer?: string[]; exitCode?: number };
          try {
            msg = JSON.parse(event.data as string) as typeof msg;
          } catch {
            return;
          }

          if (msg.t === 'o' && msg.d) {
            // Parse activity from raw data before writing to xterm — this works
            // even when the terminal tab is hidden (xterm defers processing).
            const activity = parseTerminalActivity(msg.d);
            for (const title of activity.titles) handleTitleChange(title);
            if (activity.hasBell) {
              activityTracker.handleBell();
            } else if (msg.d.length > 0) {
              // Any non-bell PTY output is an activity signal. Bell is handled
              // separately because it transitions directly to 'waiting'.
              activityTracker.bumpActivity();
            }

            if (isPinnedRef.current) {
              term.write(msg.d);
              scheduleScroll();
            } else {
              // Preserve viewport position when unpinned — xterm's write() can
              // auto-scroll the viewport even when the user has scrolled up.
              const savedY = term.buffer.active.viewportY;
              term.write(msg.d, () => {
                const currentY = term.buffer.active.viewportY;
                if (currentY !== savedY) {
                  term.scrollLines(savedY - currentY);
                }
              });
            }
          } else if (msg.t === 'reconnected' && msg.buffer) {
            console.log(`[terminal-ui] Reconnected session ${sessionId}, buffer lines: ${msg.buffer.length}`);
            activityTracker.suppress();
            term.clear();
            term.write(msg.buffer.join(''), () => {
              term.scrollToBottom();
            });
            isPinnedRef.current = true;
            setShowScrollButton(false);
          } else if (msg.t === 'exit') {
            const code = msg.exitCode ?? 0;
            console.log(`[terminal-ui] Exit for session ${sessionId}: code=${code}`);
            socket.markFinal();
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
            socket.markFinal();
            onStatusChange(sessionId, 'error');
            term.write('\r\n\x1b[31m[Error: no daemon connected]\x1b[0m\r\n');
            if (isPinnedRef.current) scheduleScroll();
          }
        },
        onClose: (event) => {
          console.log(`[terminal-ui] WS closed for session ${sessionId}: code=${event.code} reason=${event.reason}`);
        },
        onError: (event) => {
          if (isCleanedUp) return;
          console.error(`[terminal-ui] WS error for session ${sessionId}: readyState=${socket.readyState}`, event);
        },
      },
    });
    socketRef.current = socket;
    onReady?.(sessionId, actions);

    // Intercept Shift+Enter to send shell line continuation
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') {
          socket.send(JSON.stringify({ t: 'i', sessionId, d: '\\\r' }));
        }
        return false;
      }
      return true;
    });

    term.onData((data) => {
      socket.send(JSON.stringify({ t: 'i', sessionId, d: data }));
      activityTracker.resetOnUserInput();
    });

    const resizeObserver = new ResizeObserver(fitAndSyncResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      isCleanedUp = true;
      clearTimeout(fitTimer);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
      activityTracker.dispose();
      scrollSub.dispose();
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('focusin', fitAndSyncResize);
      resizeObserver.disconnect();
      onReady?.(sessionId, null);
      socket.close();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      socketRef.current = null;
    };
    // Intentionally only depends on sessionId and fitAndSyncResize — do NOT add tab or scope
    // to avoid reconnecting when props change. sessionId is stable per tab lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, fitAndSyncResize]);

  useEffect(() => {
    if (xtermRef.current && xtermTheme) {
      xtermRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  // Repaint and refit terminal when the dockview panel becomes visible (tab switch).
  // xterm's renderer pauses while display:none → need refresh() to repaint.
  // fitAndSyncResize re-syncs PTY dimensions in case the viewport changed while
  // the panel was hidden (e.g. mobile ↔ desktop switch).
  useEffect(() => {
    if (!panelApi) return;
    const disposable = panelApi.onDidVisibilityChange((e) => {
      if (e.isVisible) {
        requestAnimationFrame(() => {
          const term = xtermRef.current;
          if (term) term.refresh(0, term.rows - 1);
          fitAndSyncResize();
        });
      }
    });
    return () => disposable.dispose();
  }, [panelApi, fitAndSyncResize]);

  return (
    <div className="flex size-full">
      <div className="relative flex-1 min-w-0">
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
      {isMobile && <MobileTerminalControls onKey={sendKey} />}
    </div>
  );
}
