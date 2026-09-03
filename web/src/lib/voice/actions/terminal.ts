import type { VoiceAction } from '../registry';
import { matchByName } from './navigation';

export interface VoiceTerminalVocabEntry {
  sessionId: string;
  label: string;
  activity: 'idle' | 'active' | 'waiting' | 'done';
  stopped: boolean;
  /** Dynamic OSC title, when the shell set one — usually the running command. */
  detail?: string;
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

// The recognizer writes small numbers as words about as often as digits, and
// "to"/"for"/"won" are what it produces for 2/4/1 in front of a noun.
const HOMOPHONES: Record<string, number> = {
  to: 2,
  too: 2,
  for: 4,
  fore: 4,
  won: 1,
  ate: 8,
};

function parseOrdinal(spoken: string): number | null {
  const trimmed = spoken
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/, '');
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) return asNumber;
  return ORDINAL_WORDS[trimmed] ?? HOMOPHONES[trimmed] ?? null;
}

function resolveTerminalTarget(
  sessions: VoiceTerminalVocabEntry[],
  spoken: string,
): VoiceTerminalVocabEntry | undefined {
  const ordinal = parseOrdinal(spoken);
  if (ordinal !== null) return ordinal <= sessions.length ? sessions[ordinal - 1] : undefined;
  return matchByName(sessions, spoken, (s) => s.label);
}

const ACTIVITY_WORDS: Record<VoiceTerminalVocabEntry['activity'], string> = {
  idle: 'idle',
  active: 'running',
  waiting: 'waiting for you',
  done: 'done',
};

function describe(entry: VoiceTerminalVocabEntry, ordinal: number): string {
  if (entry.stopped) return `${ordinal}. ${entry.label} — stopped`;
  const detail = entry.detail ? ` (${entry.detail})` : '';
  return `${ordinal}. ${entry.label} — ${ACTIVITY_WORDS[entry.activity]}${detail}`;
}

/** Sorted so what needs the user comes first; a status readout is only
 * useful if the terminal wanting attention is at the top of it. */
const ATTENTION_ORDER: VoiceTerminalVocabEntry['activity'][] = [
  'waiting',
  'done',
  'active',
  'idle',
];

function summarize(sessions: VoiceTerminalVocabEntry[]): string {
  const ordered = sessions
    .map((entry, index) => ({ entry, ordinal: index + 1 }))
    .sort(
      (a, b) =>
        ATTENTION_ORDER.indexOf(a.entry.activity) - ATTENTION_ORDER.indexOf(b.entry.activity),
    );
  return ordered.map(({ entry, ordinal }) => describe(entry, ordinal)).join('\n');
}

/**
 * Terminals by number ("focus terminal 2") or label. Numbers come from the
 * caller's ordering of open terminals and are shown on the rail while voice
 * is on, so what the user reads is what they can say.
 *
 * Focus reuses the existing `terminal:focus` window event (FR-TERMINAL-240's
 * path) rather than a new signal — the terminal manager activates the
 * dockview panel, whose `focusin` sends the `{t:'ack', sessionId}` itself.
 */
export function createTerminalActions(deps: TerminalActionsDeps): VoiceAction[] {
  if (deps.sessions.length === 0) return [];

  return [
    {
      id: 'voice.terminal.focus',
      title: 'Focus terminal',
      // "select" first because it is the verb already used for projects, so
      // it is what comes to mind; the rest are what people say instead.
      phrases: [
        'select terminal {name}',
        'focus terminal {name}',
        'open terminal {name}',
        'switch to terminal {name}',
        'go to terminal {name}',
      ],
      params: [{ name: 'name', description: 'Terminal number or label' }],
      run: (ctx) => {
        const target = resolveTerminalTarget(deps.sessions, ctx.params.name);
        if (!target) return `No terminal matching "${ctx.params.name}".`;
        if (typeof window === 'undefined') return;
        window.dispatchEvent(
          new CustomEvent('terminal:focus', { detail: { sessionId: target.sessionId } }),
        );
        return `Focused ${target.label}.`;
      },
    },
    {
      id: 'voice.terminal.status.all',
      title: 'Terminal status',
      phrases: ['terminal status', 'status', 'how are the terminals'],
      run: () => summarize(deps.sessions),
    },
    {
      id: 'voice.terminal.status.one',
      title: 'Status of one terminal',
      // Only a trailing {name} is a placeholder, so "terminal 2 status" is
      // not expressible — every phrase here ends with the target.
      phrases: ['status of terminal {name}', 'status terminal {name}', 'check terminal {name}'],
      params: [{ name: 'name', description: 'Terminal number or label' }],
      run: (ctx) => {
        const target = resolveTerminalTarget(deps.sessions, ctx.params.name);
        if (!target) return `No terminal matching "${ctx.params.name}".`;
        return describe(target, deps.sessions.indexOf(target) + 1);
      },
    },
  ];
}
