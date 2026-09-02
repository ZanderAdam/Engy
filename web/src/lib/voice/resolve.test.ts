import { describe, it, expect } from 'vitest';
import type { VoiceAction } from './registry';
import { VoiceActionRegistry } from './registry';
import type { MatchTier, ResolveFailureReason, ResolvedAction, ResolveResult } from './resolve';
import { DEFAULT_ACTION_THRESHOLD, resolveAction, stripWakeWord } from './resolve';

function expectRejected(result: ResolveResult, reason: ResolveFailureReason): void {
  expect(result).toEqual({ matched: false, reason });
}

function expectResolved(
  result: ResolveResult,
  expected: Partial<ResolvedAction> & { tier: MatchTier },
): void {
  expect(result.matched).toBe(true);
  if (result.matched) {
    expect(result.result).toMatchObject(expected);
  }
}

const helpAction: VoiceAction = {
  id: 'voice.help',
  title: 'Show voice help',
  phrases: ['what can I say', 'show voice help', 'help'],
  run: () => {},
};

const selectProjectAction: VoiceAction = {
  id: 'nav.select-project',
  title: 'Select project',
  phrases: ['select project {name}'],
  params: [{ name: 'name' }],
  run: () => {},
};

const actions = [helpAction, selectProjectAction];

describe('resolve', () => {
  describe('stripWakeWord', () => {
    // The recognizer has no word for the wake word and renders it as
    // fragments — every spelling here is one the recognizer actually
    // produced for a spoken "Angie" during testing, not an invented variant.
    it.each([
      ['ANGIE select project web', 'exact'],
      ['Angie, select project web', 'trailing punctuation'],
      ['Engie select project web', 'phonetic variant'],
      ['NG select project web', 'collapsed to two letters'],
      ['N G select project web', 'spelled out'],
    ])('[FR-TG2.13] should strip the wake word from "%s" (%s)', (transcript) => {
      expect(stripWakeWord(transcript, 'ANGIE')).toBe('select project web');
    });

    it('should leave a transcript unchanged when it carries no wake word', () => {
      expect(stripWakeWord('select project web', 'ANGIE')).toBe('select project web');
    });

    it('should trim surrounding whitespace on an empty or wake-word-only transcript', () => {
      expect(stripWakeWord('  Angie,  ', 'ANGIE')).toBe('');
      expect(stripWakeWord('   ', 'ANGIE')).toBe('');
    });

    // Stripping a fragment is only safe while no command phrase begins with
    // one. These are the first words of every registered phrase plus the
    // ordinary lead-ins that a mis-stripped prefix would corrupt.
    it.each([
      'select project web',
      'go to tab docs',
      'open project web',
      'focus terminal build',
      'switch to terminal build',
      'what can I say',
      'show voice help',
      'help me please',
      'and open the tasks page',
      'end the session now',
      'okay let us begin',
    ])(
      '[FR-TG2.13] should not mistake the leading word in "%s" for the wake word',
      (transcript) => {
        expect(stripWakeWord(transcript, 'ANGIE')).toBe(transcript);
      },
    );
  });

  describe('resolveAction', () => {
    it('[FR-TG2.1] should resolve a registered action by its exact declared phrase', () => {
      expectResolved(resolveAction('help', actions), {
        action: helpAction,
        phrase: 'help',
        params: {},
        confidence: 1,
        tier: 'exact',
      });
    });

    it('[FR-TG2.1] should extract a parameter value from a templated phrase', () => {
      expectResolved(resolveAction('select project web', actions), {
        action: selectProjectAction,
        params: { name: 'web' },
        tier: 'exact',
      });
    });

    it('[FR-TG2.3] should fall back to a phonetic match when no phrase matches exactly', () => {
      const result = resolveAction('show voice hell', actions);
      expectResolved(result, { action: helpAction, tier: 'phonetic' });
      if (result.matched) {
        expect(result.result.confidence).toBeGreaterThanOrEqual(DEFAULT_ACTION_THRESHOLD);
        expect(result.result.confidence).toBeLessThan(1);
      }
    });

    it("should use DEFAULT_ACTION_THRESHOLD when the caller omits resolveAction's threshold", () => {
      const withDefault = resolveAction('show voice hell', actions);
      const withExplicitDefault = resolveAction(
        'show voice hell',
        actions,
        DEFAULT_ACTION_THRESHOLD,
      );
      expect(withDefault).toEqual(withExplicitDefault);
    });

    it('[FR-TG2.3] should reject an unrelated transcript rather than guessing', () => {
      expectRejected(resolveAction('completely unrelated request', actions), 'no_match');
    });

    it('[FR-TG2.3] should reject an empty transcript', () => {
      expectRejected(resolveAction('   ', actions), 'empty');
    });

    it('[FR-TG2.3] should reject when no actions are registered', () => {
      expectRejected(resolveAction('help', []), 'no_actions');
    });

    it.each([
      ['select project engie web', 'engie web'],
      ['select project n g web', 'n g web'],
      ['select project energy web', 'energy web'],
    ])(
      '[FR-TG2.3] should resolve "%s", a mangled transcription of the "engy-web" slug',
      (transcript, expectedParam) => {
        const result = resolveAction(transcript, actions);
        expect(result.matched).toBe(true);
        if (result.matched) {
          expect(result.result.action.id).toBe('nav.select-project');
          expect(result.result.params.name).toBe(expectedParam);
        }
      },
    );

    it('[FR-TG2.3] should prefer a literal phrase over a competing templated capture, regardless of registration order', () => {
      const projectSettingsAction: VoiceAction = {
        id: 'nav.project-settings',
        title: 'Project settings',
        phrases: ['select project settings'],
        run: () => {},
      };

      const capturesFirst = resolveAction('select project settings', [
        selectProjectAction,
        projectSettingsAction,
      ]);
      const literalFirst = resolveAction('select project settings', [
        projectSettingsAction,
        selectProjectAction,
      ]);

      expect(capturesFirst.matched && capturesFirst.result.action.id).toBe('nav.project-settings');
      expect(literalFirst.matched && literalFirst.result.action.id).toBe('nav.project-settings');
    });

    it('should reject a placeholder-only phrase rather than matching every transcript', () => {
      const catchAllAction: VoiceAction = {
        id: 'nav.catch-all',
        title: 'Catch all',
        phrases: ['{anything}'],
        run: () => {},
      };

      expectRejected(resolveAction('completely unrelated request', [catchAllAction]), 'no_match');
    });

    it('should reject a captured parameter that is punctuation only', () => {
      expectRejected(resolveAction('select project ,', [selectProjectAction]), 'no_match');
    });
  });

  describe('VoiceActionRegistry', () => {
    it('[FR-TG2.1] should register and list an action', () => {
      const registry = new VoiceActionRegistry();
      registry.register(helpAction);
      expect(registry.list()).toEqual([helpAction]);
      expect(registry.get('voice.help')).toBe(helpAction);
    });

    it('should throw when registering a duplicate id', () => {
      const registry = new VoiceActionRegistry();
      registry.register(helpAction);
      expect(() => registry.register(helpAction)).toThrow(/already registered/);
    });

    it('should allow re-registering an id after it is unregistered', () => {
      const registry = new VoiceActionRegistry();
      registry.register(helpAction);
      registry.unregister('voice.help');
      expect(registry.get('voice.help')).toBeUndefined();
      expect(() => registry.register(helpAction)).not.toThrow();
    });
  });
});
