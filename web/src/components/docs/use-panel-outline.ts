'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { DockviewPanelApi } from 'dockview';
import type { DocumentEditorHandle } from '@/components/editor/dynamic-document-editor';
import { useDocDock } from './doc-dock-context';
import { headingsEqual, type OutlineHeading } from './doc-outline';

/**
 * Wires a dock panel's editor to the shared outline. Only the active panel
 * publishes, so the sidebar always reflects the foreground document. Returns a
 * ref to attach to the editor and an `onOutlineChange` handler to forward its
 * headings.
 */
export function usePanelOutline(api: DockviewPanelApi) {
  const { publishOutline } = useDocDock();
  const editorRef = useRef<DocumentEditorHandle>(null);
  const headingsRef = useRef<OutlineHeading[]>([]);
  const publishedRef = useRef<OutlineHeading[] | null>(null);
  const activeRef = useRef(api.isActive);

  // Stable across renders — editorRef is a ref, so the closure never goes stale.
  const scrollTo = useCallback((id: string) => editorRef.current?.scrollToHeading(id), []);

  const publish = useCallback(() => {
    if (!activeRef.current) return;
    publishedRef.current = headingsRef.current;
    publishOutline({ headings: headingsRef.current, scrollTo });
  }, [publishOutline, scrollTo]);

  useEffect(() => {
    // Seed from the committed active state (the constructor read can race the
    // first Dockview composite), then publish if this panel mounts active.
    activeRef.current = api.isActive;
    const disposable = api.onDidActiveChange(({ isActive }) => {
      activeRef.current = isActive;
      if (isActive) publish();
    });
    if (activeRef.current) publish();
    return () => disposable.dispose();
  }, [api, publish]);

  const onOutlineChange = useCallback(
    (headings: OutlineHeading[]) => {
      headingsRef.current = headings;
      // Edits that don't change the heading structure must not re-publish —
      // otherwise every keystroke re-renders the sidebar (and the page root).
      if (!publishedRef.current || !headingsEqual(headings, publishedRef.current)) publish();
    },
    [publish],
  );

  return { editorRef, onOutlineChange };
}
