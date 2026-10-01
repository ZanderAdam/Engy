import { useCallback, useState } from 'react';

export interface InboxDisplayOptions {
  showSnoozed: boolean;
  unreadFirst: boolean;
}

const STORAGE_KEY = 'engy:inbox:display-options';
const DEFAULT_OPTIONS: InboxDisplayOptions = { showSnoozed: false, unreadFirst: true };

export function parseDisplayOptions(raw: string | null): InboxDisplayOptions {
  if (!raw) return DEFAULT_OPTIONS;
  try {
    const parsed: Partial<InboxDisplayOptions> = JSON.parse(raw);
    return {
      showSnoozed:
        typeof parsed.showSnoozed === 'boolean' ? parsed.showSnoozed : DEFAULT_OPTIONS.showSnoozed,
      unreadFirst:
        typeof parsed.unreadFirst === 'boolean' ? parsed.unreadFirst : DEFAULT_OPTIONS.unreadFirst,
    };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function readStored(): InboxDisplayOptions {
  try {
    return parseDisplayOptions(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function writeStored(options: InboxDisplayOptions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    return;
  }
}

export function useInboxDisplayOptions() {
  const [options, setOptions] = useState(readStored);

  const update = useCallback((patch: Partial<InboxDisplayOptions>) => {
    setOptions((current) => {
      const next = { ...current, ...patch };
      writeStored(next);
      return next;
    });
  }, []);

  return { options, update };
}
