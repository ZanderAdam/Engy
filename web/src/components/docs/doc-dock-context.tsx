'use client';

import { createContext, useContext } from 'react';
import type { DocScope } from './types';
import type { DocOutlineState } from './doc-outline';

export interface DocDockContextValue {
  scope: DocScope;
  repos: string[];
  openDoc: (filePath: string) => void;
  closeDoc: (filePath: string) => void;
  renameDoc: (oldPath: string, newPath: string) => void;
  /** Active panel reports its outline here; the manager forwards it to the page. */
  publishOutline: (outline: DocOutlineState) => void;
}

export const DocDockContext = createContext<DocDockContextValue | null>(null);

export function useDocDock(): DocDockContextValue {
  const ctx = useContext(DocDockContext);
  if (!ctx) throw new Error('useDocDock must be used within DocDockContext');
  return ctx;
}
