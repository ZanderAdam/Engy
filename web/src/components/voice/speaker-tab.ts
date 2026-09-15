type SpeakerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SpeakerTab {
  claim: () => void;
  release: () => void;
  isSpeaker: () => boolean;
}

function browserStorage(): SpeakerStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Every tab open on a workspace receives an agent's spoken reply, so without
 * one owner the same answer plays once per tab, overlapping. The tab focused
 * last owns playback; `localStorage` is the one store all tabs share.
 */
export function createSpeakerTab(
  workspaceSlug: string,
  storage: SpeakerStorage | undefined = browserStorage(),
  tabId: string = Math.random().toString(36).slice(2),
  hasFocus: () => boolean = () => document.hasFocus(),
): SpeakerTab {
  const key = `engy.voice.speaker:${workspaceSlug}`;

  function owner(): string | null {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function claim(): void {
    try {
      storage?.setItem(key, tabId);
    } catch {
      // Blocked storage leaves no owner, so focus decides instead.
    }
  }

  function release(): void {
    try {
      if (storage?.getItem(key) === tabId) storage.removeItem(key);
    } catch {
      // Nothing was claimed if storage is blocked.
    }
  }

  function isSpeaker(): boolean {
    const current = owner();
    if (current !== null) return current === tabId;
    // Focus, unlike visibility, is held by one tab at most: a claim made by
    // every visible tab at once would race, since storage writes reach other
    // tabs late.
    if (!hasFocus()) return false;
    claim();
    const claimed = owner();
    return claimed === null || claimed === tabId;
  }

  return { claim, release, isSpeaker };
}
