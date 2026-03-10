'use client';

import { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { useThemeFlavor } from '@/components/theme-provider';
import type { ITheme } from '@xterm/xterm';

export const DARK_XTERM_THEME: ITheme = {
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
};

const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  cursorAccent: '#ffffff',
  selectionBackground: '#c0c0c0',
  black: '#1a1a1a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#fafafa',
  brightBlack: '#737373',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

const CYBERPUNK: ITheme = {
  background: '#120808',
  foreground: '#ff4444',
  cursor: '#6070ff',
  cursorAccent: '#120808',
  selectionBackground: '#4a0e0e',
  black: '#120808',
  red: '#ff2020',
  green: '#55dd55',
  yellow: '#ffaa00',
  blue: '#5070ff',
  magenta: '#ff40ff',
  cyan: '#7088ff',
  white: '#ff6655',
  brightBlack: '#551515',
  brightRed: '#ff5050',
  brightGreen: '#77ee77',
  brightYellow: '#ffcc30',
  brightBlue: '#7090ff',
  brightMagenta: '#ff70ff',
  brightCyan: '#90a0ff',
  brightWhite: '#ffaa99',
};

export function useXtermTheme(): ITheme {
  const { resolvedTheme } = useTheme();
  const { flavor } = useThemeFlavor();

  return useMemo(() => {
    if (flavor === 'cyberpunk') return CYBERPUNK;
    return resolvedTheme === 'light' ? LIGHT : DARK_XTERM_THEME;
  }, [resolvedTheme, flavor]);
}
