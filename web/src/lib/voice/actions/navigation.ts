import type { VoiceAction } from '../registry';
import { phoneticSimilarity } from '../phonetic';

const NAME_MATCH_THRESHOLD = 0.6;

export interface VoiceProjectVocabEntry {
  slug: string;
  name: string;
}

export interface VoiceTabVocabEntry {
  id: string;
  label: string;
}

interface NavigationActionsDeps {
  workspaceSlug: string;
  projects: VoiceProjectVocabEntry[];
  tabs: VoiceTabVocabEntry[];
  navigate: (path: string) => void;
  activateTab: (tabId: string) => void;
}

/** Best phonetic match for STT-mangled free text against a live name list,
 * rejecting below threshold rather than guessing. */
export function matchByName<T>(
  items: T[],
  spoken: string,
  getName: (item: T) => string,
): T | undefined {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = phoneticSimilarity(spoken, getName(item));
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= NAME_MATCH_THRESHOLD ? best.item : undefined;
}

/**
 * "select project {name}" and "open tab {name}". Project navigation always
 * goes through `deps.navigate` (the caller's `navigateOrReuseTab`-backed
 * push), never a direct path assignment, so a project already open in
 * another tab is reused instead of duplicated. "open tab" only switches
 * among already-open tabs (`activateTab`), which carries no duplicate risk.
 */
export function createNavigationActions(deps: NavigationActionsDeps): VoiceAction[] {
  const actions: VoiceAction[] = [];

  if (deps.projects.length > 0) {
    actions.push({
      id: 'voice.navigation.select-project',
      title: 'Select project',
      phrases: ['select project {name}', 'go to project {name}', 'open project {name}'],
      params: [{ name: 'name', description: 'Project name' }],
      run: (ctx) => {
        const target = matchByName(deps.projects, ctx.params.name, (p) => p.name);
        if (!target) return;
        deps.navigate(`/w/${deps.workspaceSlug}/projects/${target.slug}`);
      },
    });
  }

  if (deps.tabs.length > 0) {
    actions.push({
      id: 'voice.navigation.open-tab',
      title: 'Open tab',
      phrases: ['open tab {name}', 'switch to tab {name}', 'go to tab {name}'],
      params: [{ name: 'name', description: 'Tab title' }],
      run: (ctx) => {
        const target = matchByName(deps.tabs, ctx.params.name, (t) => t.label);
        if (!target) return;
        deps.activateTab(target.id);
      },
    });
  }

  return actions;
}
