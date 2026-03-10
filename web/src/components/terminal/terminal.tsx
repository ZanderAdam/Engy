"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { TerminalTab } from "./types";

export interface TerminalActions {
  write: (data: string) => void;
  kill: () => void;
}

interface TerminalProps {
  tab: TerminalTab;
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
    cols: '80',
    rows: '24',
  });
  if (scope.command) params.set('command', scope.command);
  return `${base}/ws/terminal?${params.toString()}`;
}

export function TerminalInstance({ tab, onStatusChange, onReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionId = tab.sessionId;

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
      theme: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#3e3e3e',
        black: '#0a0a0a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#fafafa',
        brightBlack: '#525252',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    const fitTimer = setTimeout(() => { if (!isCleanedUp) fitAddon.fit(); }, 50);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const ws = new WebSocket(buildWsUrl(tab));
    wsRef.current = ws;

    ws.onopen = () => {
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
        term.write(msg.d);
      } else if (msg.t === 'reconnected' && msg.buffer) {
        term.clear();
        for (const line of msg.buffer) {
          term.write(line);
        }
      } else if (msg.t === 'exit') {
        onStatusChange(sessionId, 'exited');
        term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n');
      } else if (msg.t === 'error') {
        onStatusChange(sessionId, 'error');
        term.write('\r\n\x1b[31m[Error: no daemon connected]\x1b[0m\r\n');
      }
    };

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

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
