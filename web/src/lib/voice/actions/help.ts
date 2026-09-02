import type { VoiceAction } from '../registry';

interface HelpActionsDeps {
  openHelp: () => void;
}

/**
 * "what can I say" / "help" — registered like any other action so the help
 * surface it opens lists itself (FR-TG2.10: reachable without the keyboard).
 * Assembled by `useVoiceVocabulary`, which is the registry the resolver
 * matches against; building it anywhere else means help renders but never
 * resolves.
 */
export function createHelpActions(deps: HelpActionsDeps): VoiceAction[] {
  return [
    {
      id: 'voice.help.show',
      title: 'Show voice help',
      phrases: ['what can I say', 'what can I do', 'show voice help', 'help'],
      run: () => deps.openHelp(),
    },
  ];
}
