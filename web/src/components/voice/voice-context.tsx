'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { useVoiceCapture, type VoiceCaptureState } from './use-voice-capture';

type VoiceControl = VoiceCaptureState & { toggle: () => void };

const VoiceContext = createContext<VoiceControl | null>(null);

/** Null when the workspace has voice off, which is how a consumer decides
 * whether to offer a dictation control at all. */
export function useOptionalVoice(): VoiceControl | null {
  return useContext(VoiceContext);
}

function ActiveVoiceProvider({
  workspaceSlug,
  children,
}: {
  workspaceSlug: string;
  children: ReactNode;
}) {
  return (
    <VoiceContext.Provider value={useVoiceCapture(workspaceSlug)}>{children}</VoiceContext.Provider>
  );
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
