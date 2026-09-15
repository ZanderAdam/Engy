import { createRequire } from 'node:module';
import path from 'node:path';
import type { OfflineTts as OfflineTtsClass, OfflineTtsConfig } from 'sherpa-onnx-node';

import { findVoice } from '@/lib/voice/voices';
import { resolveTtsModelDir, ttsModelFiles } from './tts-models';

// sherpa-onnx-node's CommonJS exports are invisible to Node's ESM lexer; a
// named import passes under Vitest's interop but throws in the real server —
// same trap as recognizer.ts and spotter.ts.
const { OfflineTts } = createRequire(import.meta.url)('sherpa-onnx-node') as {
  OfflineTts: new (config: OfflineTtsConfig) => OfflineTtsClass;
};

// Long inputs are a mistake upstream, not something to render — a spoken
// answer nobody can interrupt is worse than a truncated one.
export const MAX_SPEAK_CHARS = 600;

// Acknowledgements repeat constantly ("Sent.", "Focused build."). Synthesis
// is only ~60ms so this is latency polish, not a necessity; the cap keeps a
// long-running server from growing without bound.
const CACHE_LIMIT = 64;
const cache = new Map<string, Buffer>();

// Each engine holds a whole model in memory, and every reply in a browser
// uses one voice, so only the most recently used engines are kept.
const MAX_ENGINES = 2;
const engines = new Map<string, Promise<OfflineTtsClass>>();

// Map keeps insertion order, so the first key is the oldest.
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  if (map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function getTts(model: string): Promise<OfflineTtsClass> {
  const existing = engines.get(model);
  if (existing) {
    // Map keeps insertion order, so re-inserting marks this model as newest.
    engines.delete(model);
    engines.set(model, existing);
    return existing;
  }

  const engine = (async () => {
    const dir = await resolveTtsModelDir(model);
    const files = ttsModelFiles(model);
    return new OfflineTts({
      model: {
        vits: {
          model: path.join(dir, files.model),
          tokens: path.join(dir, files.tokens),
          dataDir: path.join(dir, files.dataDir),
        },
        numThreads: 2,
        provider: 'cpu',
        debug: false,
      },
      maxNumSentences: 1,
    });
  })().catch((err: unknown) => {
    // Never cache a failed load — the next caller should retry rather than
    // inherit a permanently rejected promise. Only this load's own entry: an
    // evicted load can fail after a newer one for the same model is cached.
    if (engines.get(model) === engine) engines.delete(model);
    throw err;
  });
  setBounded(engines, model, engine, MAX_ENGINES);
  return engine;
}

function toWav(samples: Float32Array, sampleRate: number): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Renders one utterance to a WAV buffer, ready to hand a browser `Audio`.
 *
 * WAV rather than raw PCM because the browser plays it with a plain `<audio>`
 * source — no Web Audio graph, no worklet, no sample-rate negotiation. The
 * file is small enough (a 6s answer is ~190KB) that the simplicity wins.
 */
export async function synthesize(text: string, voiceId?: string | null): Promise<Buffer> {
  // Cap first, then trim: trimming first lets the cap land mid-word and leave
  // a trailing space, so the same capped utterance keys the cache twice.
  const trimmed = text.slice(0, MAX_SPEAK_CHARS).trim();
  if (!trimmed) throw new Error('Nothing to speak.');

  const voice = findVoice(voiceId);
  const key = `${voice.id}:${trimmed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const tts = await getTts(voice.model);
  const audio = tts.generate({ text: trimmed, sid: voice.speakerId, speed: 1.0 });
  const wav = toWav(audio.samples, audio.sampleRate);

  setBounded(cache, key, wav, CACHE_LIMIT);
  return wav;
}

/** Loads the voice ahead of the first utterance so a user who just enabled
 * TTS does not wait ~1.7s for the model on their first spoken answer. */
export function preloadTts(): void {
  void getTts(findVoice(null).model).catch(() => {
    // Preload is best-effort; the first real synthesize() surfaces the error.
  });
}
