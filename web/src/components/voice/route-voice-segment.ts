import { stripWakeWord } from '@/lib/voice/resolve';

type VoiceSegmentRoute =
  | { kind: 'dictation'; text: string }
  | { kind: 'command'; text: string };

/**
 * The dual-mode decision at the heart of push-to-talk: every segment is
 * already decoded regardless of the wake word (FR-TG2.12 — the key hold is
 * the deliberate gesture), so this is what decides what a decoded segment
 * MEANS. No wake word -> dictation, the transcript verbatim. Wake word
 * present -> a command, stripped of the wake prefix (FR-TG2.13) before the
 * caller resolves it against the action registry, per FR-TG2.16.
 */
export function routeVoiceSegment(
  transcript: string,
  wake: boolean,
  wakePrefixes: readonly string[],
): VoiceSegmentRoute {
  if (!wake) return { kind: 'dictation', text: transcript };

  // Longest first: "okay angie" must not lose only "angie" and leave "okay"
  // sitting in front of the command.
  const byLength = [...wakePrefixes].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
  for (const wakeWord of byLength) {
    const stripped = stripWakeWord(transcript, wakeWord);
    if (stripped !== transcript) return { kind: 'command', text: stripped };
  }
  return { kind: 'command', text: transcript };
}
