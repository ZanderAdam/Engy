'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { VoiceAction } from '@/lib/voice/registry';
import { useVoiceCapture, type VoiceCaptureState } from './use-voice-capture';
import { useVoiceVocabulary } from './use-voice-vocabulary';

export type VoiceControl = VoiceCaptureState & {
  toggle: () => void;
  actions: VoiceAction[];
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
};

const VoiceContext = createContext<VoiceControl | null>(null);

/** Null when the workspace has voice off, which is how a consumer decides
 * whether to offer a dictation control at all. */
export function useOptionalVoice(): VoiceControl | null {
  return useContext(VoiceContext);
}

/**
 * Owns the one action registry. The resolver and the help dialog must match
 * and render the *same* list, so the registry is assembled here and shared,
 * rather than each consumer building its own.
 */
function ActiveVoiceProvider({
  workspaceSlug,
  children,
}: {
  workspaceSlug: string;
  children: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const actions = useVoiceVocabulary(openHelp);
  const capture = useVoiceCapture(workspaceSlug, actions);

  const value = useMemo(
    () => ({ ...capture, actions, helpOpen, setHelpOpen }),
    [capture, actions, helpOpen],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

/**
 * Subscribing is what arms the push-to-talk key listener and opens the mic, so
 * the hook is called only from the inner component that a voice-enabled
 * workspace renders. A disabled workspace never mounts it.
 */
export function VoiceProvider({
  enabled,
  workspaceSlug,
  children,
}: {
  enabled: boolean;
  workspaceSlug: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return <ActiveVoiceProvider workspaceSlug={workspaceSlug}>{children}</ActiveVoiceProvider>;
}
