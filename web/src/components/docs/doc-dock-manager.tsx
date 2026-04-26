'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewPanelProps,
} from 'dockview';
import { DocDockContext, type DocDockContextValue } from './doc-dock-context';
import { DocDockTab } from './doc-dock-tab';
import { DocDockWatermark } from './doc-dock-watermark';
import type { DocPanelParams, DocScope, DocTab } from './types';
import { clearLayout, loadLayout, saveLayout } from './doc-dock-storage';

const ENGY_THEME = {
  name: 'engy',
  className: 'dockview-theme-engy',
};

const TAB_COMPONENTS = { 'doc-tab': DocDockTab };

function basename(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

export interface DocDockHandle {
  openDoc: (filePath: string) => void;
  closeDoc: (filePath: string) => void;
  renameDoc: (oldPath: string, newPath: string) => void;
  closeDocsUnder: (dirPath: string) => void;
  renameDocsUnder: (oldDir: string, newDir: string) => void;
}

interface DocDockManagerProps {
  scope: DocScope;
  repos: string[];
  panelComponent: React.ComponentType<IDockviewPanelProps<DocPanelParams>>;
  initialFile: string | null;
  onActiveFileChange: (filePath: string | null) => void;
}

export const DocDockManager = forwardRef<DocDockHandle, DocDockManagerProps>(function DocDockManager(
  { scope, repos, panelComponent, initialFile, onActiveFileChange },
  ref,
) {
  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const restoringRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupKeyRef = useRef(scope.groupKey);
  const onActiveFileChangeRef = useRef(onActiveFileChange);
  const initialFileRef = useRef(initialFile);

  useEffect(() => {
    groupKeyRef.current = scope.groupKey;
  }, [scope.groupKey]);

  useEffect(() => {
    onActiveFileChangeRef.current = onActiveFileChange;
  }, [onActiveFileChange]);

  const components = useMemo(
    () => ({ doc: panelComponent as React.FunctionComponent<IDockviewPanelProps> }),
    [panelComponent],
  );

  const addPanel = useCallback(
    (
      api: DockviewApi,
      filePath: string,
      position?: { referencePanel: string; direction: 'within'; index?: number },
    ) => {
      const tab: DocTab = { filePath };
      api.addPanel({
        id: filePath,
        component: 'doc',
        tabComponent: 'doc-tab',
        title: basename(filePath),
        params: { tab } satisfies DocPanelParams,
        renderer: 'always',
        ...(position && { position }),
      });
    },
    [],
  );

  const openDoc = useCallback(
    (filePath: string) => {
      const api = dockviewApiRef.current;
      if (!api || !filePath) return;
      const existing = api.getPanel(filePath);
      if (existing) {
        existing.api.setActive();
        return;
      }
      addPanel(api, filePath);
    },
    [addPanel],
  );

  const closeDoc = useCallback((filePath: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    api.getPanel(filePath)?.api.close();
  }, []);

  const renameDoc = useCallback((oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    const api = dockviewApiRef.current;
    if (!api) return;
    const existing = api.getPanel(oldPath);
    if (!existing) return;

    if (api.getPanel(newPath)) {
      const wasActive = api.activePanel?.id === oldPath;
      existing.api.close();
      if (wasActive) api.getPanel(newPath)?.api.setActive();
      return;
    }

    const wasActive = api.activePanel?.id === oldPath;
    const group = existing.group;
    const groupPanels = group.panels.map((p) => p.id);
    const index = groupPanels.indexOf(oldPath);
    existing.api.close();

    const referencePanel = groupPanels.find((id) => id !== oldPath && api.getPanel(id));
    addPanel(
      api,
      newPath,
      referencePanel
        ? { referencePanel, direction: 'within', index }
        : undefined,
    );

    if (wasActive) api.getPanel(newPath)?.api.setActive();
  }, [addPanel]);

  const closeDocsUnder = useCallback((dirPath: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    for (const panel of [...api.panels]) {
      if (panel.id === dirPath || panel.id.startsWith(prefix)) {
        panel.api.close();
      }
    }
  }, []);

  const renameDocsUnder = useCallback((oldDir: string, newDir: string) => {
    if (oldDir === newDir) return;
    const api = dockviewApiRef.current;
    if (!api) return;
    const oldPrefix = oldDir.endsWith('/') ? oldDir : `${oldDir}/`;
    const newPrefix = newDir.endsWith('/') ? newDir : `${newDir}/`;
    const matches = api.panels.filter((p) => p.id.startsWith(oldPrefix)).map((p) => p.id);
    for (const oldId of matches) {
      renameDoc(oldId, newPrefix + oldId.slice(oldPrefix.length));
    }
  }, [renameDoc]);

  useImperativeHandle(
    ref,
    () => ({ openDoc, closeDoc, renameDoc, closeDocsUnder, renameDocsUnder }),
    [openDoc, closeDoc, renameDoc, closeDocsUnder, renameDocsUnder],
  );

  const flushLayoutSave = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    if (api.panels.length === 0) {
      clearLayout(groupKeyRef.current);
    } else {
      saveLayout(groupKeyRef.current, api.toJSON());
    }
  }, []);

  const scheduleLayoutSave = useCallback(() => {
    if (restoringRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushLayoutSave();
    }, 200);
  }, [flushLayoutSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayoutSave();
      }
    };
  }, [flushLayoutSave]);

  const handleDockviewReady = useCallback(
    (event: { api: DockviewApi }) => {
      const api = event.api;
      dockviewApiRef.current = api;

      api.onDidActivePanelChange((panel) => {
        onActiveFileChangeRef.current(panel?.id ?? null);
        scheduleLayoutSave();
      });
      api.onDidRemovePanel(() => scheduleLayoutSave());
      api.onDidAddPanel(() => scheduleLayoutSave());
      api.onDidMovePanel(() => scheduleLayoutSave());
      api.onDidAddGroup(() => scheduleLayoutSave());
      api.onDidRemoveGroup(() => scheduleLayoutSave());

      const savedLayout = loadLayout(groupKeyRef.current);
      let restored = false;
      if (savedLayout) {
        try {
          const hydratedPanels = Object.fromEntries(
            Object.entries(savedLayout.panels).map(([id, panel]) => [
              id,
              { ...panel, params: { tab: { filePath: id } satisfies DocTab } },
            ]),
          );
          const hydrated = { ...savedLayout, panels: hydratedPanels };
          restoringRef.current = true;
          api.fromJSON(hydrated);
          restoringRef.current = false;
          restored = api.panels.length > 0;
          if (!restored) clearLayout(groupKeyRef.current);
        } catch (err) {
          restoringRef.current = false;
          console.error('Failed to restore doc layout:', err);
          clearLayout(groupKeyRef.current);
        }
      }

      if (!restored && initialFileRef.current) {
        addPanel(api, initialFileRef.current);
      }
    },
    [scheduleLayoutSave, addPanel],
  );

  const contextValue = useMemo<DocDockContextValue>(
    () => ({ scope, repos, openDoc, closeDoc, renameDoc }),
    [scope, repos, openDoc, closeDoc, renameDoc],
  );

  const dockviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = dockviewRef.current;
    if (!container) return;

    const tabsContainer = container.querySelector<HTMLElement>('.dv-tabs-container');
    if (!tabsContainer) return;

    function onWheel(e: WheelEvent) {
      if (e.deltaY === 0) return;
      e.preventDefault();
      tabsContainer!.scrollLeft += e.deltaY;
    }

    tabsContainer.addEventListener('wheel', onWheel, { passive: false });
    return () => tabsContainer.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <DocDockContext.Provider value={contextValue}>
      <DockviewReact
        ref={dockviewRef}
        className="flex-1 min-h-0"
        theme={ENGY_THEME}
        components={components}
        tabComponents={TAB_COMPONENTS}
        watermarkComponent={DocDockWatermark}
        onReady={handleDockviewReady}
        disableFloatingGroups
        defaultRenderer="always"
        scrollbars="native"
      />
    </DocDockContext.Provider>
  );
});
