import type { VoiceAction, VoiceActionContext } from './registry';
import { editDistance, normalizeToken, phoneticSimilarity } from './phonetic';

export const DEFAULT_ACTION_THRESHOLD = 0.68;
const WAKE_WORD_RAW_MATCH_THRESHOLD = 0.6;
const MAX_WAKE_WORD_WORDS = 3;

export type MatchTier = 'exact' | 'phonetic';

export interface ResolvedAction {
  action: VoiceAction;
  phrase: string;
  params: VoiceActionContext['params'];
  confidence: number;
  tier: MatchTier;
}

export type ResolveFailureReason = 'empty' | 'no_actions' | 'no_match';

export type ResolveResult =
  | { matched: true; result: ResolvedAction }
  | { matched: false; reason: ResolveFailureReason };

interface ParsedPhrase {
  words: string[];
  paramName: string | null;
}

function parsePhrase(phrase: string): ParsedPhrase {
  const tokens = phrase.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? '';
  const placeholder = /^\{(\w+)\}$/.exec(last);

  if (placeholder) {
    return { words: tokens.slice(0, -1), paramName: placeholder[1] };
  }
  return { words: tokens, paramName: null };
}

interface PhraseMatch {
  tier: MatchTier;
  confidence: number;
  params: VoiceActionContext['params'];
}

function matchFixedWords(
  fixedWords: string[],
  phraseWords: string[],
): { tier: MatchTier; confidence: number } {
  const spoken = fixedWords.join('');
  const expected = phraseWords.join('');

  if (normalizeToken(spoken) === normalizeToken(expected)) {
    return { tier: 'exact', confidence: 1 };
  }
  return { tier: 'phonetic', confidence: phoneticSimilarity(spoken, expected) };
}

function matchPhrase(transcriptWords: string[], parsed: ParsedPhrase): PhraseMatch | null {
  if (parsed.paramName) {
    if (parsed.words.length === 0) return null;
    if (transcriptWords.length <= parsed.words.length) return null;

    const fixedWords = transcriptWords.slice(0, parsed.words.length);
    const paramWords = transcriptWords.slice(parsed.words.length);
    if (!normalizeToken(paramWords.join(''))) return null;

    const { tier, confidence } = matchFixedWords(fixedWords, parsed.words);
    return { tier, confidence, params: { [parsed.paramName]: paramWords.join(' ') } };
  }

  const { tier, confidence } = matchFixedWords(transcriptWords, parsed.words);
  return { tier, confidence, params: {} };
}

export function resolveAction(
  transcript: string,
  actions: VoiceAction[],
  threshold: number = DEFAULT_ACTION_THRESHOLD,
): ResolveResult {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { matched: false, reason: 'empty' };
  if (actions.length === 0) return { matched: false, reason: 'no_actions' };

  let bestExact: { result: ResolvedAction; fixedWordCount: number } | null = null;
  let bestFuzzy: ResolvedAction | null = null;

  for (const action of actions) {
    for (const phraseTemplate of action.phrases) {
      const parsed = parsePhrase(phraseTemplate);
      const match = matchPhrase(words, parsed);
      if (!match) continue;

      if (match.tier === 'exact') {
        if (!bestExact || parsed.words.length > bestExact.fixedWordCount) {
          bestExact = {
            result: {
              action,
              phrase: phraseTemplate,
              params: match.params,
              confidence: 1,
              tier: 'exact',
            },
            fixedWordCount: parsed.words.length,
          };
        }
        continue;
      }

      if (!bestFuzzy || match.confidence > bestFuzzy.confidence) {
        bestFuzzy = {
          action,
          phrase: phraseTemplate,
          params: match.params,
          confidence: match.confidence,
          tier: 'phonetic',
        };
      }
    }
  }

  if (bestExact) return { matched: true, result: bestExact.result };
  if (bestFuzzy && bestFuzzy.confidence >= threshold) {
    return { matched: true, result: bestFuzzy };
  }
  return { matched: false, reason: 'no_match' };
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (index < needle.length && char === needle[index]) index += 1;
  }
  return index === needle.length;
}

function rawSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

export function stripWakeWord(transcript: string, wakeWord: string): string {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const normalizedWake = normalizeToken(wakeWord);
  const maxPrefixWords = Math.min(MAX_WAKE_WORD_WORDS, words.length);

  for (let prefixLength = maxPrefixWords; prefixLength >= 1; prefixLength--) {
    const prefixTokens = words.slice(0, prefixLength);
    const joined = normalizeToken(prefixTokens.join(''));
    if (!joined) continue;

    const isSpelledOut = prefixTokens.every((token) => normalizeToken(token).length === 1);
    const matches =
      joined === normalizedWake ||
      (isSpelledOut && joined.length >= 2 && isSubsequence(joined, normalizedWake)) ||
      (prefixLength === 1 &&
        joined.length >= 3 &&
        rawSimilarity(joined, normalizedWake) >= WAKE_WORD_RAW_MATCH_THRESHOLD);

    if (matches) {
      return words
        .slice(prefixLength)
        .join(' ')
        .replace(/^[\s,.!?;:]+/, '');
    }
  }

  return words.join(' ');
}
