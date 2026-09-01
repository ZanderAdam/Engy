import { describe, expect, it } from 'vitest';
import { routeVoiceSegment } from './route-voice-segment';

const WAKE_WORDS = ['ANGIE', 'OK ANGIE', 'HEY ANGIE'];

describe('routeVoiceSegment', () => {
  it('[FR-TG2.16] should route a transcript with no wake word to dictation, verbatim', () => {
    expect(routeVoiceSegment('open the pod bay doors', false, WAKE_WORDS)).toEqual({
      kind: 'dictation',
      text: 'open the pod bay doors',
    });
  });

  it('[FR-TG2.16] should route a transcript carrying the wake word to a command', () => {
    const route = routeVoiceSegment('Angie select project web', true, WAKE_WORDS);
    expect(route.kind).toBe('command');
  });

  it('[FR-TG2.13] should strip the wake prefix from a routed command', () => {
    const route = routeVoiceSegment('Angie select project web', true, WAKE_WORDS);
    expect(route).toEqual({ kind: 'command', text: 'select project web' });
  });

  it('[FR-TG2.13] should strip a comma-separated wake prefix', () => {
    const route = routeVoiceSegment('Angie, select project web', true, WAKE_WORDS);
    expect(route).toEqual({ kind: 'command', text: 'select project web' });
  });

  it('[FR-TG2.13] should strip a multi-word wake variant whole, not just its tail', () => {
    // "ok angie" must not lose only "angie" and leave "ok" in front of the command.
    expect(routeVoiceSegment('ok angie select project web', true, WAKE_WORDS)).toEqual({
      kind: 'command',
      text: 'select project web',
    });
  });

  it('[FR-TG2.13] should strip the hey variant whole', () => {
    expect(routeVoiceSegment('hey angie open tab docs', true, WAKE_WORDS)).toEqual({
      kind: 'command',
      text: 'open tab docs',
    });
  });

  it('[FR-TG2.13] should strip a phonetically-mangled wake prefix', () => {
    const route = routeVoiceSegment('Engie select project web', true, WAKE_WORDS);
    expect(route).toEqual({ kind: 'command', text: 'select project web' });
  });

  it('should route to an empty command when the segment is only the wake word', () => {
    expect(routeVoiceSegment('Angie', true, WAKE_WORDS)).toEqual({ kind: 'command', text: '' });
  });

  it('[FR-TG2.16] should still route to a command when the wake word is not literally in the text', () => {
    // A real rising-edge wake detection with a transcript the recognizer
    // decoded independently — stripWakeWord finds no matching prefix, so
    // the full text passes through unstripped rather than being dropped.
    const route = routeVoiceSegment('select project web', true, WAKE_WORDS);
    expect(route).toEqual({ kind: 'command', text: 'select project web' });
  });

  it('should never insert a command-routed transcript as dictation text', () => {
    const route = routeVoiceSegment('Angie select project web', true, WAKE_WORDS);
    expect(route.kind).not.toBe('dictation');
  });

  it('should preserve an empty transcript as dictation when wake is false', () => {
    expect(routeVoiceSegment('', false, WAKE_WORDS)).toEqual({ kind: 'dictation', text: '' });
  });

  it('is pure — repeated calls with the same input return equal results', () => {
    const a = routeVoiceSegment('Angie help', true, WAKE_WORDS);
    const b = routeVoiceSegment('Angie help', true, WAKE_WORDS);
    expect(a).toEqual(b);
  });
});
