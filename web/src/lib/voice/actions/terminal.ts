import type { VoiceAction } from '../registry';
import { matchByName } from './navigation';

export interface VoiceTerminalVocabEntry {
  sessionId: string;
  label: string;
}

interface TerminalActionsDeps {
  sessions: VoiceTerminalVocabEntry[];
}

const ORDINAL_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseOrdinal(spoken: string): number | null {
  const trimmed = spoken.trim().toLowerCase();
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) return asNumber;
  return ORDINAL_WORDS[trimmed] ?? null;
}

function resolveTerminalTarget(
  sessions: VoiceTerminalVocabEntry[],
  spoken: string,
): VoiceTerminalVocabEntry | undefined {
  const ordinal = parseOrdinal(spoken);
  if (ordinal !== null && ordinal <= sessions.length) return sessions[ordinal - 1];
  return matchByName(sessions, spoken, (s) => s.label);
}

/**
 * "focus terminal {name}" by ordinal ("focus terminal 2") or label. Reuses
 * the existing `terminal:focus` window event (FR-TERMINAL-240's path) rather
 * than a new signal — the terminal manager focuses the dockview panel, whose
 * `focusin` sends the `{t:'ack', sessionId}` message itself.
 */
export function createTerminalActions(deps: TerminalActionsDeps): VoiceAction[] {
  if (deps.sessions.length === 0) return [];

  return [
    {
      id: 'voice.terminal.focus',
      title: 'Focus terminal',
      phrases: ['focus terminal {name}', 'switch to terminal {name}', 'go to terminal {name}'],
      params: [{ name: 'name', description: 'Terminal ordinal or label' }],
      run: (ctx) => {
        const target = resolveTerminalTarget(deps.sessions, ctx.params.name);
        if (!target || typeof window === 'undefined') return;
        window.dispatchEvent(
          new CustomEvent('terminal:focus', { detail: { sessionId: target.sessionId } }),
        );
      },
    },
  ];
}
