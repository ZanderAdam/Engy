import { useSyncExternalStore } from 'react';

const QUERY = '(hover: hover)';

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  // Assume hover-capable on the server so desktop (the common case) keeps its
  // hover-reveal affordances without a first-paint flash.
  return true;
}

// True when the device has a hover-capable pointer (mouse/trackpad). Touch
// devices report false, so hover-revealed controls must be shown unconditionally
// there — hover never fires on touch, leaving them permanently unreachable.
export function useCanHover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
