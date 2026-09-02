'use client';

import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { useTabsList, useVirtualNavigate, useVirtualParams } from '@/components/tabs/tab-context';
import type { VirtualParams } from '@/components/tabs/tab-state';
import { useOpenTerminals } from '@/components/terminal/terminal-session-store';
import { isStoppedTerminal, type TerminalTab } from '@/components/terminal/types';
import type { VoiceAction } from '@/lib/voice/registry';
import {
  createNavigationActions,
  type VoiceProjectVocabEntry,
  type VoiceTabVocabEntry,
} from '@/lib/voice/actions/navigation';
import { createTerminalActions, type VoiceTerminalVocabEntry } from '@/lib/voice/actions/terminal';
import { createHelpActions } from '@/lib/voice/actions/help';

/**
 * The open terminals, numbered as the rail shows them. Not the server's
 * session registry: focus works by activating a dockview panel, so a
 * persisted session with no open panel cannot be focused and must not take a
 * number — numbering sessions the user cannot see was why "focus terminal N"
 * silently did nothing.
 */
function toTerminalVocab(tabs: TerminalTab[]): VoiceTerminalVocabEntry[] {
  return tabs.map((tab) => ({
    sessionId: tab.sessionId,
    label: tab.scope.scopeLabel,
    activity: tab.activityState ?? 'idle',
    stopped: isStoppedTerminal(tab.status),
    detail: tab.oscTitle,
  }));
}

interface VocabularyInput {
  workspaceSlug: string;
  projects: VoiceProjectVocabEntry[];
  tabs: VoiceTabVocabEntry[];
  sessions: VoiceTerminalVocabEntry[];
  navigate: (path: string) => void;
  activateTab: (tabId: string) => void;
  openHelp: () => void;
}

/** Pure assembly, independent of how each list was fetched — this is what
 * "the live vocabulary" turns into actions, and what tests exercise directly. */
export function assembleVoiceVocabulary(input: VocabularyInput): VoiceAction[] {
  if (!input.workspaceSlug) return [];
  return [
    ...createNavigationActions({
      workspaceSlug: input.workspaceSlug,
      projects: input.projects,
      tabs: input.tabs,
      navigate: input.navigate,
      activateTab: input.activateTab,
    }),
    ...createTerminalActions({ sessions: input.sessions }),
    ...createHelpActions({ openHelp: input.openHelp }),
  ];
}

/**
 * Live voice actions built from open projects, open tabs, and every terminal
 * session on the server. Refetches terminal sessions on an interval, same as
 * `useTaskTerminals`, so a session opened elsewhere becomes speakable without
 * a page reload.
 *
 * The single place the registry is assembled. Help belongs here, not beside
 * the dialog it opens: a registry built for rendering help is not the one the
 * resolver matches against, so "what can I say" listed itself and then failed
 * to resolve.
 */
export function useVoiceVocabulary(openHelp: () => void): VoiceAction[] {
  const params = useVirtualParams<VirtualParams>();
  const workspaceSlug = params.workspace ?? '';

  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );
  const { data: projects } = trpc.project.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );
  const openTerminals = useOpenTerminals();
  const sessions = useMemo(() => toTerminalVocab(openTerminals), [openTerminals]);

  const tabsList = useTabsList();
  const { push } = useVirtualNavigate();

  return useMemo(
    () =>
      assembleVoiceVocabulary({
        workspaceSlug,
        projects: (projects ?? []).map((p) => ({ slug: p.slug, name: p.name })),
        tabs: (tabsList?.tabs ?? []).map((t) => ({ id: t.id, label: t.title })),
        sessions,
        navigate: push,
        activateTab: (id) => tabsList?.activateTab(id),
        openHelp,
      }),
    [workspaceSlug, projects, tabsList, sessions, push, openHelp],
  );
}
