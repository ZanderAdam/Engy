import { createRequire } from 'node:module';
import path from 'node:path';
import type { OfflineTts as OfflineTtsClass, OfflineTtsConfig } from 'sherpa-onnx-node';

import { resolveTtsModelDir, TTS_MODEL_FILES } from './tts-models';

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

let ttsPromise: Promise<OfflineTtsClass> | null = null;

async function getSharedTts(): Promise<OfflineTtsClass> {
  ttsPromise ??= (async () => {
    const dir = await resolveTtsModelDir();
    return new OfflineTts({
      model: {
        vits: {
          model: path.join(dir, TTS_MODEL_FILES.model),
          tokens: path.join(dir, TTS_MODEL_FILES.tokens),
          dataDir: path.join(dir, TTS_MODEL_FILES.dataDir),
        },
        numThreads: 2,
        provider: 'cpu',
        debug: false,
      },
      maxNumSentences: 1,
    });
  })().catch((err: unknown) => {
    // Never cache a failed load — the next caller should retry rather than
    // inherit a permanently rejected promise.
    ttsPromise = null;
    throw err;
  });
  return ttsPromise;
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
export async function synthesize(text: string): Promise<Buffer> {
  // Cap first, then trim: trimming first lets the cap land mid-word and leave
  // a trailing space, so the same capped utterance keys the cache twice.
  const trimmed = text.slice(0, MAX_SPEAK_CHARS).trim();
  if (!trimmed) throw new Error('Nothing to speak.');

  const hit = cache.get(trimmed);
  if (hit) return hit;

  const tts = await getSharedTts();
  const audio = tts.generate({ text: trimmed, sid: 0, speed: 1.0 });
  const wav = toWav(audio.samples, audio.sampleRate);

  if (cache.size >= CACHE_LIMIT) {
    // Map keeps insertion order, so the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(trimmed, wav);
  return wav;
}

/** Loads the voice ahead of the first utterance so a user who just enabled
 * TTS does not wait ~1.7s for the model on their first spoken answer. */
export function preloadTts(): void {
  void getSharedTts().catch(() => {
    // Preload is best-effort; the first real synthesize() surfaces the error.
  });
}
