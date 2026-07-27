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
import { createTerminalActivityParser, parseTerminalActivity } from "./parse-terminal-activity";
import { createActivityTracker } from "./activity-tracker";
import { ReconnectingSocket } from "./reconnecting-socket";
import { MobileTerminalControls } from "./mobile-terminal-controls";
import { MobileComposer } from "./mobile-composer";
import { toBracketedPaste } from "./bracketed-paste";
import { shouldSendResize } from "./terminal-resize";
import { attachTouchScroll } from "./touch-scroll";
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
  onOscTitle?: (sessionId: string, title: string) => void;
  panelApi?: DockviewPanelApi;
}

const ACTIVITY_DEBOUNCE_MS = 3000;
const TITLE_SUPPRESS_MS = 3000;
// Short window to ignore the redraw a PTY emits in response to a resize
// (dock collapse/expand animation, tab reselect, drag-resize) — long enough to
// cover the redraw, short enough not to mask genuine activity.
const RESIZE_SUPPRESS_MS = 1000;

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
  if (scope.agentType) params.set('agentType', scope.agentType);
  if (scope.workspaceSlug) params.set('workspaceSlug', scope.workspaceSlug);
  if (scope.projectId != null) params.set('projectId', String(scope.projectId));
  if (scope.projectSlug) params.set('projectSlug', scope.projectSlug);
  if (scope.worktreeBranch) params.set('worktreeBranch', scope.worktreeBranch);
  if (scope.containerMode) params.set('containerMode', scope.containerMode);
  if (scope.taskId != null) params.set('taskId', String(scope.taskId));
  if (scope.resumedFrom) params.set('resumedFrom', scope.resumedFrom);
  return `${base}/ws/terminal?${params.toString()}`;
}

export function TerminalInstance({ tab, xtermTheme, onStatusChange, onReady, onActivity, onOscTitle, panelApi }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReconnectingSocket | null>(null);
  const lastSentColsRef = useRef(0);
  const lastSentRowsRef = useRef(0);
  const activityTrackerRef = useRef<ReturnType<typeof createActivityTracker> | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [composing, setComposing] = useState(false);
  const sessionId = tab.sessionId;
  const isMobile = useIsMobile();

  const sendKey = useCallback(
    (data: string) => {
      socketRef.current?.send(JSON.stringify({ t: 'i', sessionId, d: data }));
    },
    [sessionId],
  );

  const submitComposed = useCallback(
    (text: string) => {
      setComposing(false);
      sendKey(toBracketedPaste(text));
      // Submit as its own frame, so the program has processed the paste before
      // the Enter lands — the same ordering `useSendToTerminal` relies on.
      setTimeout(() => sendKey('\r'), 50);
    },
    [sendKey],
  );

  const handleScrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
    setShowScrollButton(false);
  }, []);

  const fitAndSyncResize = useCallback(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const term = xtermRef.current;
    const socket = socketRef.current;
    if (!container || !fitAddon || !term) return;

    // Skip when panel is hidden (display:none gives 0 dimensions)
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

    fitAddon.fit();

    // Only send resize to server when dimensions actually changed
    if (!shouldSendResize(term.cols, term.rows, lastSentColsRef.current, lastSentRowsRef.current)) return;

    // Record the size only once it's actually on the wire. ReconnectingSocket
    // drops sends while the socket isn't OPEN (e.g. mid-reconnect/remount), so
    // updating the guard before a dropped send would leave term.cols === lastSent
    // — a later focus/resize would then see "no change" and never re-sync the
    // PTY, leaving it stuck until a collapse/expand changed the row count.
    if (socket?.readyState !== WebSocket.OPEN) return;
    lastSentColsRef.current = term.cols;
    lastSentRowsRef.current = term.rows;
    socket.send(JSON.stringify({ t: 'resize', sessionId, cols: term.cols, rows: term.rows }));
    // A resize makes the program redraw (e.g. while the dock collapse/expand
    // animation steps through widths, or on tab reselect). That redraw is not
    // agent activity, so ignore the burst briefly — without disturbing the
    // current dot or a pending settle — to avoid flipping done/idle to active.
    activityTrackerRef.current?.suppressOutput(RESIZE_SUPPRESS_MS);
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

    // xterm only sets autocorrect/autocapitalize/spellcheck on its hidden input.
    // Chrome for Android ignores those (crbug.com/901839), so the virtual keyboard
    // still runs predictive text over a terminal — composing words ahead of the
    // cursor and corrupting backspace. `inputmode` is the one lever Android does
    // honour: it maps to an input type the keyboard treats as suggestion-free,
    // while keeping a normal layout (space bar included) on both iOS and Android.
    term.textarea?.setAttribute('autocomplete', 'off');
    term.textarea?.setAttribute('inputmode', 'email');

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    setShowScrollButton(false);

    // Activity detection via OSC title changes and PTY output bytes parsed from
    // raw WebSocket data. This works even when the terminal tab is hidden
    // (display:none), unlike xterm's onTitleChange which defers processing.
    // One stateful parser instance per session so OSC sequences split across
    // WS chunks are reassembled before title/bell detection.
    const activityParser = createTerminalActivityParser();
    let lastTitle = '';
    const activityTracker = createActivityTracker({
      debounceMs: ACTIVITY_DEBOUNCE_MS,
      suppressMs: TITLE_SUPPRESS_MS,
      onActivity: (event: ActivityEvent) => onActivity?.(sessionId, event),
    });
    activityTrackerRef.current = activityTracker;

    const handleTitleChange = (title: string) => {
      if (title === lastTitle) return;
      lastTitle = title;
      activityTracker.bumpActivity();
      onOscTitle?.(sessionId, title);
      // Server keeps the last title as the session's resume summary; the
      // message terminates there (never relayed to the daemon).
      socketRef.current?.send(JSON.stringify({ t: 'title', sessionId, title }));
    };

    // xterm's BufferService.isUserScrolling is the single source of truth for
    // auto-follow: scrolling into the scrollback sets it, reaching the bottom
    // clears it, and output follows the bottom only while it is clear. Mirroring
    // that with our own "pinned" flag is what used to snap the view back — the
    // mirror could disagree with xterm and every write then forced a
    // scrollToBottom(), which also reset isUserScrolling. So we only read the
    // buffer here, to decide whether the "Bottom" button is needed.
    const scrollSub = term.onScroll(() => {
      const buf = term.buffer.active;
      setShowScrollButton(buf.viewportY < buf.baseY);
    });

    const container = containerRef.current;

    // Nudge one line on an upward wheel from the bottom so small trackpad deltas
    // escape the auto-follow zone: while following, each write resets the
    // viewport, so sub-line deltas never accumulate into a scroll of their own.
    // The nudge sets isUserScrolling, which durably stops output from following.
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY >= 0) return;
      const buf = term.buffer.active;
      if (buf.baseY > 0 && buf.viewportY >= buf.baseY) term.scrollLines(-1);
    };
    container.addEventListener('wheel', handleWheel, { passive: true });

    // Touch scrolling is driven here rather than by xterm, whose own touch
    // handlers bail out while a program has mouse reporting on — which every
    // agent TUI does. Native scrolling doesn't cover for them either: only
    // `.xterm-viewport` scrolls, and `.xterm-screen` overlays it, so a drag
    // lands on the viewport only in the margins beyond the last row/column.
    const detachTouchScroll = attachTouchScroll(container, {
      rows: () => term.rows,
      scrollLines: (lines) => term.scrollLines(lines),
    });
    // focusin bubbles from xterm's textarea (unlike focus), so any click/keyboard
    // focus re-syncs PTY size when the viewport changed while the panel was hidden,
    // and acknowledges the session so a done/waiting indicator clears once viewed.
    // The ack is also relayed so the server meta and daemon tracker clear too —
    // otherwise the per-project badge keeps counting this session as done/waiting.
    const handleFocusIn = () => {
      fitAndSyncResize();
      activityTracker.acknowledge();
      socketRef.current?.send(JSON.stringify({ t: 'ack', sessionId }));
    };
    container.addEventListener('focusin', handleFocusIn);

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
            const activity = activityParser.parse(msg.d);
            for (const title of activity.titles) handleTitleChange(title);
            if (activity.hasBell) {
              activityTracker.handleBell();
            } else if (msg.d.length > 0) {
              // Any non-bell PTY output is an activity signal. Bell is handled
              // separately because it transitions directly to 'waiting'. A
              // detected input-prompt biases the eventual settle to 'waiting'
              // (blocked) rather than 'done' (finished).
              activityTracker.bumpActivity(activity.hasPrompt);
            }

            // xterm natively preserves the viewport while the user is scrolled
            // up (its BufferService.isUserScrolling flag, set whenever we or the
            // wheel/touch handlers scroll into the scrollback) and follows the
            // bottom otherwise. Writing plainly leans on that.
            term.write(msg.d);
          } else if (msg.t === 'reconnected' && msg.buffer) {
            console.log(`[terminal-ui] Reconnected session ${sessionId}, buffer lines: ${msg.buffer.length}`);
            activityTracker.suppress();
            term.clear();
            const replay = msg.buffer.join('');
            // Re-apply the last OSC title from the replayed scrollback — a
            // program that set its title once before the reconnect would
            // otherwise leave the tab on the stale fallback label.
            const replayTitles = parseTerminalActivity(replay).titles;
            if (replayTitles.length > 0) handleTitleChange(replayTitles[replayTitles.length - 1]);
            term.write(replay, () => {
              term.scrollToBottom();
            });
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
          } else if (msg.t === 'error') {
            console.error(`[terminal-ui] Error for session ${sessionId}: no daemon`);
            socket.markFinal();
            onStatusChange(sessionId, 'error');
            term.write('\r\n\x1b[31m[Error: no daemon connected]\x1b[0m\r\n');
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
      activityTracker.dispose();
      activityTrackerRef.current = null;
      scrollSub.dispose();
      container.removeEventListener('wheel', handleWheel);
      detachTouchScroll();
      container.removeEventListener('focusin', handleFocusIn);
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
        {/* Panning is ours — a browser-claimed pan cancels the pointer stream
            mid-drag — but two-finger zoom stays with the browser. */}
        <div ref={containerRef} className="size-full touch-pinch-zoom" />
        {isMobile && composing && (
          <MobileComposer onCancel={() => setComposing(false)} onSubmit={submitComposed} />
        )}
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
      {isMobile && (
        <MobileTerminalControls onKey={sendKey} onCompose={() => setComposing(true)} />
      )}
    </div>
  );
}
