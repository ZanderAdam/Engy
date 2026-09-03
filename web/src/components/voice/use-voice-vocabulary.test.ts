import { describe, it, expect, vi } from 'vitest';
import { resolveAction } from '@/lib/voice/resolve';
import { assembleVoiceVocabulary } from './use-voice-vocabulary';
import { routeVoiceSegment } from './route-voice-segment';
import { WAKE_PREFIXES } from './use-voice-capture';

const SESSIONS = [
  { sessionId: 's1', label: 'build', activity: 'idle' as const, stopped: false },
  { sessionId: 's2', label: 'test', activity: 'idle' as const, stopped: false },
];

function build(over: Partial<Parameters<typeof assembleVoiceVocabulary>[0]> = {}) {
  return assembleVoiceVocabulary({
    workspaceSlug: 'engy',
    sessions: SESSIONS,
    openHelp: vi.fn(),
    submitTerminal: vi.fn(() => true),
    askTerminal: vi.fn(),
    ...over,
  });
}

describe('assembleVoiceVocabulary', () => {
  // The registry the resolver matches against and the registry the help
  // dialog renders must be the same one. They were not: help lived beside
  // the dialog, so "what can I say" listed itself in help and then failed to
  // resolve. Resolving against the assembled vocabulary is what catches that
  // — asserting on a hand-built action list cannot.
  it('[FR-TG2.10] should resolve the help phrases against the assembled vocabulary', () => {
    const openHelp = vi.fn();
    const actions = build({ openHelp });

    for (const phrase of ['what can I say', 'what can I do', 'help']) {
      const resolved = resolveAction(phrase, actions);
      expect(resolved.matched, `"${phrase}" did not resolve`).toBe(true);
      if (!resolved.matched) return;
      expect(resolved.result.action.id).toBe('voice.help.show');
    }

    const resolved = resolveAction('help', actions);
    if (!resolved.matched) return;
    void resolved.result.action.run({ params: {} });
    expect(openHelp).toHaveBeenCalled();
  });

  // Real transcripts, end to end: the recognizer renders the spoken wake
  // word as a fragment ("NG"), so routing and resolution have to survive a
  // wake word the recognizer never spells correctly.
  it.each([
    ['NG Focus Terminal Test.', 'voice.terminal.focus'],
    ['NG select terminal 1', 'voice.terminal.focus'],
    ['Angie, terminal status', 'voice.terminal.status.all'],
    ['NG send', 'voice.terminal.send'],
    ['Okay, Angie, what can I do?', 'voice.help.show'],
  ])('[FR-TG2.16] should route and resolve "%s"', (transcript, expectedId) => {
    const actions = build();
    const route = routeVoiceSegment(transcript, true, WAKE_PREFIXES);
    const resolved = resolveAction(route.text, actions);
    expect(resolved.matched, `"${route.text}" did not resolve`).toBe(true);
    if (!resolved.matched) return;
    expect(resolved.result.action.id).toBe(expectedId);
  });

  it('should return no actions without a workspace slug', () => {
    expect(build({ workspaceSlug: '' })).toEqual([]);
  });

  // Voice is terminal-only: navigating projects and tabs by voice was removed
  // after it proved unreliable in use and less useful than terminal control.
  it('should register no navigation actions', () => {
    expect(build().every((a) => !a.id.startsWith('voice.navigation.'))).toBe(true);
    expect(resolveAction('select project engy web', build()).matched).toBe(false);
    expect(resolveAction('open tab docs', build()).matched).toBe(false);
  });
});
