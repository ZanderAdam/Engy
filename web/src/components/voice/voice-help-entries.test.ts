import { describe, expect, it } from 'vitest';
import { DEFAULT_WAKE_WORD } from '@/server/voice/keywords';
import type { VoiceAction } from '@/lib/voice/registry';
import { createNavigationActions } from '@/lib/voice/actions/navigation';
import { createTerminalActions } from '@/lib/voice/actions/terminal';
import { createHelpActions } from '@/lib/voice/actions/help';
import { buildVoiceHelpEntries, groupVoiceHelpEntries } from './voice-help-entries';

const WAKE_WORD = 'ANGIE';

function selectProjectAction(): VoiceAction[] {
  return createNavigationActions({
    workspaceSlug: 'acme',
    projects: [
      { slug: 'engy-web', name: 'Engy Web' },
      { slug: 'engy-client', name: 'Engy Client' },
      { slug: 'engy-common', name: 'Engy Common' },
      { slug: 'engy-docs', name: 'Engy Docs' },
    ],
    tabs: [],
    navigate: () => {},
    activateTab: () => {},
  });
}

describe('voice help entries', () => {
  it('[test-infra] mirrors the real DEFAULT_WAKE_WORD constant', () => {
    // Client components can't import `keywords.ts` (it reads node:fs), so
    // `voice-help-dialog.tsx` keeps a local mirror of this value. This test
    // is the tripwire: if the real constant changes, this fails instead of
    // the dialog silently drifting.
    expect(WAKE_WORD).toBe(DEFAULT_WAKE_WORD);
  });

  describe('buildVoiceHelpEntries', () => {
    it('[FR-TG2.8] should derive one entry per registered action with no maintained list', () => {
      const actions: VoiceAction[] = [
        { id: 'voice.test.one', title: 'Test one', phrases: ['do a thing'], run: () => {} },
      ];
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD);
      expect(entries.map((e) => e.id)).toEqual(['voice.test.one']);
    });

    it('[FR-TG2.8] should change when an action is added to the registry, with no help-component edit', () => {
      const before = buildVoiceHelpEntries(
        [{ id: 'voice.test.one', title: 'Test one', phrases: ['do a thing'], run: () => {} }],
        WAKE_WORD,
      );

      const registryPlusNewAction: VoiceAction[] = [
        { id: 'voice.test.one', title: 'Test one', phrases: ['do a thing'], run: () => {} },
        { id: 'voice.test.two', title: 'Test two', phrases: ['do another thing'], run: () => {} },
      ];
      const after = buildVoiceHelpEntries(registryPlusNewAction, WAKE_WORD);

      expect(before.map((e) => e.id)).toEqual(['voice.test.one']);
      expect(after.map((e) => e.id)).toEqual(['voice.test.one', 'voice.test.two']);
    });

    it('[FR-TG2.8] should derive category from the action id, grouping actions by module', () => {
      const actions = [...selectProjectAction(), ...createHelpActions({ openHelp: () => {} })];
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD);
      const categories = Object.fromEntries(entries.map((e) => [e.id, e.category]));
      expect(categories['voice.navigation.select-project']).toBe('navigation');
      expect(categories['voice.help.show']).toBe('help');
    });

    it('[FR-TG2.9] should expand a templated phrase into concrete examples from live vocabulary', () => {
      const actions = selectProjectAction();
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD, () => [
        'Engy Web',
        'Engy Client',
      ]);
      const selectProject = entries.find((e) => e.id === 'voice.navigation.select-project');
      const firstPhrase = selectProject?.phrases[0];
      expect(firstPhrase?.examples).toEqual([
        'ANGIE, select project Engy Web',
        'ANGIE, select project Engy Client',
      ]);
      expect(firstPhrase?.moreCount).toBe(0);
    });

    it('[FR-TG2.9] should cap examples per phrase and report a "+N more" remainder', () => {
      const actions = selectProjectAction();
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD, () => [
        'Engy Web',
        'Engy Client',
        'Engy Common',
        'Engy Docs',
      ]);
      const firstPhrase = entries.find((e) => e.id === 'voice.navigation.select-project')
        ?.phrases[0];
      expect(firstPhrase?.examples).toHaveLength(3);
      expect(firstPhrase?.moreCount).toBe(1);
    });

    it('[FR-TG2.9] should degrade to the bare template when a parameter has no live values', () => {
      const actions = selectProjectAction();
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD, () => []);
      const firstPhrase = entries.find((e) => e.id === 'voice.navigation.select-project')
        ?.phrases[0];
      expect(firstPhrase?.examples).toEqual([]);
      expect(firstPhrase?.template).toBe('ANGIE, select project {name}');
    });

    it('[FR-TG2.9] should degrade to the bare template when no lookup is supplied at all', () => {
      const actions: VoiceAction[] = [
        {
          id: 'voice.terminal.focus',
          title: 'Focus terminal',
          phrases: ['focus terminal {name}'],
          params: [{ name: 'name' }],
          run: () => {},
        },
      ];
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD);
      expect(entries[0].phrases[0]).toEqual({
        template: 'ANGIE, focus terminal {name}',
        examples: [],
        moreCount: 0,
      });
    });

    it('[FR-TG2.10] should show the current wake word in every rendered template and example', () => {
      const actions = selectProjectAction();
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD, () => ['Engy Web']);
      const selectProject = entries.find((e) => e.id === 'voice.navigation.select-project');
      for (const phrase of selectProject?.phrases ?? []) {
        expect(phrase.template.startsWith(`${WAKE_WORD}, `)).toBe(true);
        for (const example of phrase.examples) {
          expect(example.startsWith(`${WAKE_WORD}, `)).toBe(true);
        }
      }
    });

    it('should leave a phrase with no placeholder untouched besides the wake-word prefix', () => {
      const entries = buildVoiceHelpEntries(createHelpActions({ openHelp: () => {} }), WAKE_WORD);
      const help = entries.find((e) => e.id === 'voice.help.show');
      expect(help?.phrases.map((p) => p.template)).toEqual([
        'ANGIE, what can I say',
        'ANGIE, show voice help',
        'ANGIE, help',
      ]);
    });
  });

  describe('groupVoiceHelpEntries', () => {
    it('should group entries by category, preserving registry order within a group', () => {
      const actions = [
        ...selectProjectAction(),
        ...createTerminalActions({ sessions: [{ sessionId: 's1', label: 'main' }] }),
        ...createHelpActions({ openHelp: () => {} }),
      ];
      const entries = buildVoiceHelpEntries(actions, WAKE_WORD);
      const grouped = groupVoiceHelpEntries(entries);

      expect(Object.keys(grouped)).toEqual(['navigation', 'terminal', 'help']);
      expect(grouped.navigation.map((e) => e.id)).toEqual(['voice.navigation.select-project']);
    });
  });
});
