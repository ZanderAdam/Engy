"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal, FitAddon } from "ghostty-web";
import type { Ghostty, ITheme } from "ghostty-web";
import type { TerminalPingCmd, TerminalTitleMsg } from "@engy/common";
import type { DockviewPanelApi } from "dockview";
import { DARK_TERMINAL_THEME } from "@/hooks/use-terminal-theme";
import { RiArrowDownSLine, RiPencilLine } from "@remixicon/react";
import type { ActivityEvent, TerminalTab } from "./types";
import { createTerminalActivityParser } from "./parse-terminal-activity";
import { createActivityTracker } from "./activity-tracker";
import { ReconnectingSocket } from "./reconnecting-socket";
import { MobileTerminalControls } from "./mobile-terminal-controls";
import { MobileComposer } from "./mobile-composer";
import { toBracketedPaste } from "./bracketed-paste";
import { shouldSendResize } from "./terminal-resize";
import { attachTouchScroll } from "./touch-scroll";
import { attachScrollbar } from "./scrollbar";
import { confineSelectionAutoScroll } from "./selection-autoscroll";
import { keyOverrideBytes } from "./key-overrides";
import { loadGhostty } from "./ghostty-runtime";
import { writePreservingScroll } from "./preserve-scroll";
import { attachSoftKeyboardInput } from "./soft-keyboard-input";
import { useIsMobile } from "@/hooks/use-mobile";

export interface TerminalActions {
  write: (data: string) => void;
  kill: () => void;
}

interface TerminalProps {
  tab: TerminalTab;
  terminalTheme?: ITheme;
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

export function TerminalInstance({ tab, terminalTheme, onStatusChange, onReady, onActivity, onOscTitle, panelApi }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReconnectingSocket | null>(null);
  const lastSentColsRef = useRef(0);
  const lastSentRowsRef = useRef(0);
  const activityTrackerRef = useRef<ReturnType<typeof createActivityTracker> | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [composing, setComposing] = useState(false);
  const [ghostty, setGhostty] = useState<Ghostty | null>(null);
  const [wasmFailed, setWasmFailed] = useState(false);
  const sessionId = tab.sessionId;
  const isMobile = useIsMobile();

  // ghostty-web parses VT in WebAssembly, so the module has to be fetched and
  // compiled before a terminal can exist. Gating the session effect on the
  // loaded instance keeps that effect synchronous; the module-level cache makes
  // every terminal after the first resolve without another fetch.
  useEffect(() => {
    let cancelled = false;
    loadGhostty().then(
      (instance) => {
        if (!cancelled) setGhostty(instance);
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error('[terminal-ui] Failed to load ghostty WASM', error);
        setWasmFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (wasmFailed) onStatusChange(sessionId, 'error');
  }, [wasmFailed, sessionId, onStatusChange]);

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
    termRef.current?.scrollToBottom();
    setShowScrollButton(false);
  }, []);

  const fitAndSyncResize = useCallback(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const term = termRef.current;
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
    if (!containerRef.current || !ghostty) return;

    let isCleanedUp = false;

    const term = new Terminal({
      ghostty,
      cursorBlink: true,
      convertEol: true,
      scrollback: 10000,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      theme: terminalTheme ?? DARK_TERMINAL_THEME,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // No web-links addon: ghostty-web registers OSC 8 and URL-regex link
    // providers itself when the terminal is opened.
    term.open(containerRef.current);
    const fitTimer = setTimeout(() => { if (!isCleanedUp) fitAddon.fit(); }, 50);

    // Replaces the scrollbar the emulator paints inside the text canvas, which
    // covers the rightmost columns while it is up.
    const detachScrollbar = attachScrollbar(containerRef.current, term);

    // Keeps a selection drag near the top or bottom edge from swallowing the
    // whole buffer.
    confineSelectionAutoScroll(term);

    // The emulator marks the container `contenteditable`, as a hint to browser
    // extensions that the pane takes keyboard input. On a phone the attribute
    // means more than a hint: focus on an editable element opens the on-screen
    // keyboard. Any focus of the pane thus raised the keyboard over the text the
    // user came to read. The hidden textarea is the real input, and a tap still
    // focuses it and opens the keyboard, so only the unwanted trigger goes.
    // The textbox role goes with it: the container no longer accepts an edit,
    // and the textarea inside it carries the label a reader needs.
    containerRef.current.removeAttribute('contenteditable');
    containerRef.current.removeAttribute('role');
    containerRef.current.removeAttribute('aria-multiline');

    // Predictive text is left on, overriding the emulator's own suppression of
    // it. The suppression existed because xterm read the hidden textarea
    // directly, where a keyboard composing words ahead of the cursor corrupted
    // backspace — Chrome for Android ignores autocorrect/spellcheck
    // (crbug.com/901839), so `inputmode` was the only lever that silenced it.
    // Input now arrives as `beforeinput`, where a correction is an explicit
    // `insertReplacementText` or `deleteContentBackward` that
    // `soft-keyboard-input.ts` maps like any other edit, so suggestions cost
    // nothing. Autocapitalise stays off: commands are case-sensitive.
    term.textarea?.setAttribute('autocorrect', 'on');
    term.textarea?.setAttribute('spellcheck', 'true');

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    setShowScrollButton(false);

    // Activity detection via OSC title changes and PTY output bytes parsed from
    // raw WebSocket data, rather than the emulator's own title/bell events —
    // parsing the wire keeps detection independent of how (and when) the
    // emulator surfaces them. One stateful parser instance per session so OSC
    // sequences split across WS chunks are reassembled before title/bell detection.
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
      socketRef.current?.send(
        JSON.stringify({ t: 'title', sessionId, title } satisfies TerminalTitleMsg),
      );
    };

    // ghostty-web counts viewportY in lines above the bottom, so anything above
    // zero means the user is reading scrollback and needs the "Bottom" button.
    // (xterm expressed the same thing as viewportY < baseY.)
    const scrollSub = term.onScroll((viewportY) => {
      setShowScrollButton(viewportY > 0);
    });

    const container = containerRef.current;

    // No wheel handler of our own: ghostty-web accumulates sub-line wheel deltas
    // itself, so the one-line nudge xterm needed to escape its auto-follow zone
    // has nothing left to fix — and its own listener is registered in the
    // capture phase on this same element.

    // Touch scrolling is driven here rather than by the emulator, which only
    // wires touch up to focus the input — a drag over the canvas scrolls
    // nothing. There is no scrollable DOM to fall back on either: the screen is
    // a single <canvas>, so the browser has nothing of its own to pan.
    // A keyboard that predicts words keeps a composition open across keystrokes,
    // and the emulator commits that text only when `compositionend` gives it.
    // Blur ends a composition, so a drag mid-word must not blur, or the word
    // goes nowhere.
    let composing = false;
    const onCompositionStart = () => { composing = true; };
    const onCompositionEnd = () => { composing = false; };
    container.addEventListener('compositionstart', onCompositionStart);
    container.addEventListener('compositionend', onCompositionEnd);

    const detachTouchScroll = attachTouchScroll(container, {
      rows: () => term.rows,
      scrollLines: (lines) => term.scrollLines(lines),
      // A drag must drop the input focus, not merely avoid taking it. When the
      // user hides the on-screen keyboard, the textarea keeps the focus, and a
      // phone shows the keyboard again at the next touch on a focused input —
      // with no call to focus() to stop. Blur is the only way to keep it down.
      onDragStart: () => {
        if (!composing) term.textarea?.blur();
      },
    });
    // focusin bubbles from the hidden textarea (unlike focus), so any click/keyboard
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
      // Wake recovery probes the server instead of blindly force-reconnecting —
      // a healthy socket answers with pong (handled below) and keeps its state.
      sendProbe: (ws) =>
        ws.send(JSON.stringify({ t: 'ping', sessionId } satisfies TerminalPingCmd)),
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
          let msg: { t: string; d?: string; snapshot?: string; title?: string; exitCode?: number };
          try {
            msg = JSON.parse(event.data as string) as typeof msg;
          } catch {
            return;
          }

          if (msg.t === 'o' && msg.d) {
            // Parse activity from the raw data rather than the rendered screen,
            // so it is detected even while the tab is hidden.
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

            writePreservingScroll(term, msg.d);
          } else if (msg.t === 'reconnected' && typeof msg.snapshot === 'string') {
            console.log(
              `[terminal-ui] Reconnected session ${sessionId}, snapshot: ${msg.snapshot.length} chars`,
            );
            activityTracker.suppress();
            // The snapshot re-establishes screen state from scratch, so reset
            // (not clear) — it also drops modes a torn-down program left set.
            term.reset();
            // reset() empties the buffer but leaves viewportY where the user
            // left it, and emits no scroll event to say so. Anything reading
            // that number — the re-pinning of the next write, the scrollbar —
            // would work from a position the new buffer no longer has.
            term.scrollToBottom();
            // A session that produced no output yet serializes to an empty
            // snapshot, and an empty write throws inside the emulator: it gives
            // the zero-length array to Uint8Array.set, which reports an offset
            // out of bounds and takes the pane down.
            if (msg.snapshot.length > 0) {
              term.write(msg.snapshot, () => {
                term.scrollToBottom();
              });
            }
            setShowScrollButton(false);
          } else if (msg.t === 'pong') {
            socket.confirmAlive();
          } else if (msg.t === 'title' && msg.title) {
            // Server-pushed after a resync: snapshots carry no OSC title. Track
            // it as lastTitle (not via handleTitleChange) — echoing it back to
            // the server or bumping activity would be wrong here.
            lastTitle = msg.title;
            onOscTitle?.(sessionId, msg.title);
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
            writePreservingScroll(term, `\r\n\x1b[2m[${label}]\x1b[0m\r\n`);
          } else if (msg.t === 'error') {
            console.error(`[terminal-ui] Error for session ${sessionId}: no daemon`);
            socket.markFinal();
            onStatusChange(sessionId, 'error');
            writePreservingScroll(term, '\r\n\x1b[31m[Error: no daemon connected]\x1b[0m\r\n');
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

    // Every route from this pane to the PTY: the emulator's own key encoding,
    // the chords it gets wrong, and a soft keyboard's edits. Each is the user
    // typing, so each resets the activity dot.
    const sendInput = (data: string) => {
      socket.send(JSON.stringify({ t: 'i', sessionId, d: data }));
      activityTracker.resetOnUserInput();
    };

    const detachSoftKeyboard = attachSoftKeyboardInput(container, sendInput);

    // NB: ghostty-web inverts xterm's contract for this hook despite the
    // identical name and signature — here `true` means "handled, suppress the
    // default", where xterm meant "carry on and process normally". Returning
    // xterm's values swallows every keystroke. `true` also preventDefaults,
    // which is what keeps Shift+Tab from moving the browser's focus instead.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const bytes = keyOverrideBytes(event);
      if (bytes === null) return false;
      sendInput(bytes);
      return true;
    });

    term.onData(sendInput);

    const resizeObserver = new ResizeObserver(fitAndSyncResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      isCleanedUp = true;
      clearTimeout(fitTimer);
      activityTracker.dispose();
      activityTrackerRef.current = null;
      scrollSub.dispose();
      detachScrollbar();
      detachSoftKeyboard();
      detachTouchScroll();
      container.removeEventListener('compositionstart', onCompositionStart);
      container.removeEventListener('compositionend', onCompositionEnd);
      container.removeEventListener('focusin', handleFocusIn);
      resizeObserver.disconnect();
      onReady?.(sessionId, null);
      socket.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      socketRef.current = null;
    };
    // Intentionally only depends on sessionId, fitAndSyncResize and the loaded WASM
    // instance — do NOT add tab or scope, to avoid reconnecting when props change.
    // sessionId is stable per tab lifetime; ghostty is a module-level singleton.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, fitAndSyncResize, ghostty]);

  useEffect(() => {
    if (termRef.current && terminalTheme) {
      termRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  // Refit the terminal when the dockview panel becomes visible (tab switch), in
  // case the viewport changed while it was hidden (e.g. mobile ↔ desktop switch).
  // No explicit repaint: ghostty-web renders from a requestAnimationFrame loop
  // that keeps running while the panel is display:none, so the canvas is already
  // current — the fit is what needs a frame to measure against.
  useEffect(() => {
    if (!panelApi) return;
    const disposable = panelApi.onDidVisibilityChange((e) => {
      if (e.isVisible) {
        requestAnimationFrame(() => fitAndSyncResize());
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
        {/* Without the WASM module no terminal is ever constructed, so the pane
            would otherwise sit blank and look frozen rather than broken. */}
        {wasmFailed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-xs text-red-400">
            Terminal engine failed to load. Reload the page to try again.
          </div>
        )}
        {isMobile && !composing && (
          <button
            type="button"
            aria-label="Compose message"
            onClick={() => setComposing(true)}
            className="absolute bottom-3 right-3 z-10 flex size-12 items-center justify-center rounded-full bg-zinc-700/90 text-zinc-100 shadow-lg backdrop-blur-sm active:bg-zinc-600"
          >
            <RiPencilLine className="size-5" aria-hidden />
          </button>
        )}
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
      {isMobile && <MobileTerminalControls onKey={sendKey} composing={composing} />}
    </div>
  );
}
