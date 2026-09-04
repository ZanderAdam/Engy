'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { VoiceAction } from '@/lib/voice/registry';
import { useOnServerEvent } from '@/contexts/events-context';
import {
  getVoicePttController,
  useVoiceCapture,
  type VoiceCaptureState,
} from './use-voice-capture';
import { useVoiceVocabulary } from './use-voice-vocabulary';
import { SpeechQueue, speakUrl } from './speech-queue';

export type VoiceControl = VoiceCaptureState & {
  toggle: () => void;
  answer: string | null;
  /** Queues one spoken utterance. A no-op when spoken replies are off. */
  speak: (text: string) => void;
  ttsEnabled: boolean;
  setConversation: (on: boolean) => void;
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
  ttsEnabled,
  children,
}: {
  workspaceSlug: string;
  ttsEnabled: boolean;
  children: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  // The controller owns the mode and pushes it in its state, so the mic and
  // the mode cannot disagree — this only forwards the request.
  const setConversation = useCallback(
    (on: boolean) => getVoicePttController().setConversationMode(on),
    [],
  );
  const isConversation = useCallback(() => getVoicePttController().isConversationMode(), []);
  const actions = useVoiceVocabulary(openHelp, isConversation, setConversation);
  const capture = useVoiceCapture(workspaceSlug, actions);

  // One queue for the whole workspace: an action acknowledgement and an
  // agent's `speak` can land in the same instant, and two voices at once are
  // unintelligible.
  const [queue] = useState(
    () =>
      new SpeechQueue({
        onSpeakingChange: (speaking) => getVoicePttController().setSpeaking(speaking),
      }),
  );
  // One utterance per line, not one for the whole answer: a status readout is
  // a list, and the voice does not pause on punctuation, so the gap between
  // items has to come from the queue playing them separately.
  const speak = useCallback(
    (text: string) => {
      if (!ttsEnabled) return;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) queue.enqueue(speakUrl(workspaceSlug, trimmed));
      }
    },
    [ttsEnabled, queue, workspaceSlug],
  );

  // Answers are spoken once, when they arrive — not on every render that
  // still carries the same answer.
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!capture.answer || capture.answer === spokenRef.current) return;
    spokenRef.current = capture.answer;
    speak(capture.answer);
  }, [capture.answer, speak]);

  useOnServerEvent('VOICE_SPEAK', (payload) => speak(payload.text));

  const value = useMemo(
    () => ({
      ...capture,
      actions,
      helpOpen,
      setHelpOpen,
      speak,
      ttsEnabled,
      setConversation,
    }),
    [capture, actions, helpOpen, speak, ttsEnabled, setConversation],
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
  ttsEnabled = false,
  workspaceSlug,
  children,
}: {
  enabled: boolean;
  ttsEnabled?: boolean;
  workspaceSlug: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <ActiveVoiceProvider workspaceSlug={workspaceSlug} ttsEnabled={ttsEnabled}>
      {children}
    </ActiveVoiceProvider>
  );
}
