import type { VoiceAction } from '@/lib/voice/registry';

const MAX_EXAMPLES = 3;

interface VoiceHelpPhrase {
  /** The phrase to say, wake word included. Still carries a `{param}`
   * placeholder when no live value was found for it. */
  template: string;
  examples: string[];
  moreCount: number;
}

interface VoiceHelpEntry {
  id: string;
  title: string;
  category: string;
  phrases: VoiceHelpPhrase[];
}

/** Resolves one action's parameter to its live candidate values (open
 * project names, tab titles, terminal labels, ...). Supplied by the caller,
 * which owns the live data — this module never knows what a "project" is. */
export type VoiceHelpValueLookup = (action: VoiceAction) => string[];

function categoryFromId(id: string): string {
  return id.split('.')[1] ?? 'general';
}

function expandPhrase(
  phrase: string,
  action: VoiceAction,
  wakeWord: string,
  lookupValues: VoiceHelpValueLookup,
): VoiceHelpPhrase {
  const template = `${wakeWord}, ${phrase}`;
  const placeholder = /\{(\w+)\}/.exec(phrase);
  if (!placeholder) return { template, examples: [], moreCount: 0 };

  const hasDeclaredParam = action.params?.some((p) => p.name === placeholder[1]) ?? false;
  const values = hasDeclaredParam ? lookupValues(action) : [];
  if (values.length === 0) return { template, examples: [], moreCount: 0 };

  const shown = values.slice(0, MAX_EXAMPLES);
  return {
    template,
    examples: shown.map((value) => template.replace(`{${placeholder[1]}}`, value)),
    moreCount: Math.max(0, values.length - shown.length),
  };
}

/**
 * Registry-driven: every entry comes from `actions`, so a new voice action
 * appears here with no edit to this file or whatever renders its output.
 */
export function buildVoiceHelpEntries(
  actions: VoiceAction[],
  wakeWord: string,
  lookupValues: VoiceHelpValueLookup = () => [],
): VoiceHelpEntry[] {
  return actions.map((action) => ({
    id: action.id,
    title: action.title,
    category: categoryFromId(action.id),
    phrases: action.phrases.map((phrase) => expandPhrase(phrase, action, wakeWord, lookupValues)),
  }));
}

export function groupVoiceHelpEntries(entries: VoiceHelpEntry[]): Record<string, VoiceHelpEntry[]> {
  const grouped: Record<string, VoiceHelpEntry[]> = {};
  for (const entry of entries) {
    (grouped[entry.category] ??= []).push(entry);
  }
  return grouped;
}
