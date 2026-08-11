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
  background: '#0d060a',
  foreground: '#ff6b5e',
  cursor: '#fcee0a',
  cursorAccent: '#0d060a',
  selectionBackground: '#0a3a42',
  black: '#1a0d14',
  red: '#ff2a4d',
  green: '#00ff9f',
  yellow: '#fcee0a',
  blue: '#00b8ff',
  magenta: '#ff3bd4',
  cyan: '#00f0ff',
  white: '#ffd9d4',
  brightBlack: '#5c2a3a',
  brightRed: '#ff5c73',
  brightGreen: '#5cffbe',
  brightYellow: '#fff55c',
  brightBlue: '#5cd0ff',
  brightMagenta: '#ff7ce2',
  brightCyan: '#7cf7ff',
  brightWhite: '#fff1ee',
};

export function useXtermTheme(): ITheme {
  const { resolvedTheme } = useTheme();
  const { flavor } = useThemeFlavor();

  return useMemo(() => {
    if (flavor === 'cyberpunk') return CYBERPUNK;
    return resolvedTheme === 'light' ? LIGHT : DARK_XTERM_THEME;
  }, [resolvedTheme, flavor]);
}
