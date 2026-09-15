export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const DEFAULT_RATE = 1;
const STORAGE_KEY = 'engy.voice.playbackRate';

export function readPlaybackRate(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return (PLAYBACK_RATES as readonly number[]).includes(stored) ? stored : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

export function writePlaybackRate(rate: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // Blocked storage keeps the default speed.
  }
}
