import { findVoice } from '@/lib/voice/voices';

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const DEFAULT_RATE = 1;
const RATE_KEY = 'engy.voice.playbackRate';
const VOICE_KEY = 'engy.voice.voice';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage keeps the defaults.
  }
}

export function readPlaybackRate(): number {
  const stored = Number(read(RATE_KEY));
  return (PLAYBACK_RATES as readonly number[]).includes(stored) ? stored : DEFAULT_RATE;
}

export function writePlaybackRate(rate: number): void {
  write(RATE_KEY, String(rate));
}

export function readVoiceId(): string {
  return findVoice(read(VOICE_KEY)).id;
}

export function writeVoiceId(id: string): void {
  write(VOICE_KEY, id);
}
