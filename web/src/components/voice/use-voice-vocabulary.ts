'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { useTabsList, useVirtualNavigate, useVirtualParams } from '@/components/tabs/tab-context';
import type { VirtualParams } from '@/components/tabs/tab-state';
import type { SessionListItem } from '@/components/terminal/session-to-tab';
import type { VoiceAction } from '@/lib/voice/registry';
import {
  createNavigationActions,
  type VoiceProjectVocabEntry,
  type VoiceTabVocabEntry,
} from '@/lib/voice/actions/navigation';
import { createTerminalActions, type VoiceTerminalVocabEntry } from '@/lib/voice/actions/terminal';
import { createHelpActions } from '@/lib/voice/actions/help';

/**
 * Every persisted session, across every project — the server registry, not
 * `terminal-session-store.ts`. That browser store only tracks the projects
 * currently mounted, so a terminal in a project the user isn't looking at
 * would silently vanish from the vocabulary.
 */
export async function fetchAllTerminalSessions(): Promise<VoiceTerminalVocabEntry[]> {
  const res = await fetch('/api/terminal/sessions?all=1');
  if (!res.ok) return [];
  const data = (await res.json()) as { sessions: SessionListItem[] };
  return data.sessions.map((s) => ({ sessionId: s.sessionId, label: s.scopeLabel }));
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
  const { data: sessions } = useQuery({
    queryKey: ['voice-vocabulary-terminal-sessions'],
    queryFn: fetchAllTerminalSessions,
    refetchInterval: 5_000,
  });

  const tabsList = useTabsList();
  const { push } = useVirtualNavigate();

  return useMemo(
    () =>
      assembleVoiceVocabulary({
        workspaceSlug,
        projects: (projects ?? []).map((p) => ({ slug: p.slug, name: p.name })),
        tabs: (tabsList?.tabs ?? []).map((t) => ({ id: t.id, label: t.title })),
        sessions: sessions ?? [],
        navigate: push,
        activateTab: (id) => tabsList?.activateTab(id),
        openHelp,
      }),
    [workspaceSlug, projects, tabsList, sessions, push, openHelp],
  );
}
