import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  KeywordSpotter as KeywordSpotterClass,
  KeywordSpotterConfig,
  KeywordResult,
} from 'sherpa-onnx-node';

import { resolveKwsModelDir } from './kws-models';
import { WAKE_WORDS, encodeWakeWord } from './keywords';

// sherpa-onnx-node's CommonJS exports are invisible to Node's ESM lexer; a
// named import passes under Vitest's interop but throws in the real server —
// same trap as recognizer.ts.
const { KeywordSpotter } = createRequire(import.meta.url)('sherpa-onnx-node') as {
  KeywordSpotter: new (config: KeywordSpotterConfig) => KeywordSpotterClass;
};

const SAMPLE_RATE = 16_000;

const ENCODER_FILE = 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx';
const DECODER_FILE = 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx';
const JOINER_FILE = 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx';

// Measured on real recordings, not synthesis: the model's own shipped
// "GO HOME" keyword fired on 3/7 real takes here with 0/60 false accepts,
// while every synthesized measurement scored zero including that control —
// treat TTS results for this model as void. Raising the score made
// detection strictly worse (0 hits at 3.0, every threshold), which is the
// opposite of how it reads.
const KEYWORDS_THRESHOLD = 0.05;
const KEYWORDS_SCORE = 1.0;

async function ensureKeywordsFile(kwsModelDir: string): Promise<string> {
  // Keyed by the variants themselves, so changing the wake words writes a
  // new file rather than silently reusing one encoded from the old set.
  const key = WAKE_WORDS.join('_').replace(/\s+/g, '-');
  const keywordsPath = path.join(kwsModelDir, `keywords-${key}.txt`);
  try {
    await fs.access(keywordsPath);
    return keywordsPath;
  } catch {
    // Not written yet — encode it below.
  }
  const lines = await Promise.all(
    WAKE_WORDS.map((phrase) => encodeWakeWord(phrase, kwsModelDir)),
  );
  await fs.writeFile(keywordsPath, `${lines.join('\n')}\n`, 'utf8');
  return keywordsPath;
}

let sharedSpotter: KeywordSpotterClass | null = null;
let sharedSpotterPromise: Promise<KeywordSpotterClass> | null = null;

async function loadSpotter(): Promise<KeywordSpotterClass> {
  const dir = await resolveKwsModelDir();
  const keywordsFile = await ensureKeywordsFile(dir);
  const spotter = new KeywordSpotter({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(dir, ENCODER_FILE),
        decoder: path.join(dir, DECODER_FILE),
        joiner: path.join(dir, JOINER_FILE),
      },
      tokens: path.join(dir, 'tokens.txt'),
      numThreads: 1,
      provider: 'cpu',
    },
    keywordsFile,
    keywordsThreshold: KEYWORDS_THRESHOLD,
    keywordsScore: KEYWORDS_SCORE,
  });
  sharedSpotter = spotter;
  return spotter;
}

// Loaded once and reused across turns, mirroring recognizer.ts's shared
// OfflineRecognizer: the KeywordSpotter instance is stateless model config,
// so sharing it costs nothing per turn. All per-utterance state — buffered
// frames, the armed/fired keyword — lives on the OnlineStream from
// createStream(), which is why createWakeStream() below hands out a fresh
// one per turn instead of resetting a shared stream: a stream carried across
// turns risks firing on a hit whose audio belonged to the previous turn.
async function getSharedSpotter(): Promise<KeywordSpotterClass> {
  if (sharedSpotter) return sharedSpotter;
  if (!sharedSpotterPromise) {
    sharedSpotterPromise = loadSpotter().catch((err) => {
      sharedSpotterPromise = null;
      throw err;
    });
  }
  return sharedSpotterPromise;
}

/**
 * Kicks off the KWS model download and load at the moment a workspace opts
 * into voice — mirrors `preloadRecognizer` in `recognizer.ts`, which calls
 * this so the same opt-in gate covers both models. Errors are swallowed
 * here; `createWakeStream` awaits the same in-flight work and surfaces any
 * failure there.
 */
export function preloadSpotter(): void {
  void getSharedSpotter().catch(() => {});
}

function pcm16ToFloat32(chunk: Buffer): Float32Array {
  const sampleCount = Math.floor(chunk.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = chunk.readInt16LE(i * 2) / 32_768;
  }
  return samples;
}

export interface WakeStream {
  /**
   * Feeds one chunk of PCM to the spotter. Returns true on the chunk where
   * the wake word is newly detected — a rising edge, not a level: the
   * underlying stream is reset immediately on a hit, so later speech in the
   * same turn can wake it again rather than reporting one long detection.
   */
  writeChunk(chunk: Buffer): boolean;
}

/**
 * Creates a per-turn wake-word stream against the shared, lazily-loaded
 * KeywordSpotter. Feed it raw 16 kHz s16le mono PCM via `writeChunk`,
 * alongside (not instead of) the turn's Vad — see `createTurnRecognizer` in
 * `recognizer.ts`, which uses this to decide whether a closed VAD segment
 * gets decoded at all.
 */
export async function createWakeStream(): Promise<WakeStream> {
  const spotter = await getSharedSpotter();
  const stream = spotter.createStream();

  return {
    writeChunk(chunk: Buffer): boolean {
      stream.acceptWaveform({ samples: pcm16ToFloat32(chunk), sampleRate: SAMPLE_RATE });
      while (spotter.isReady(stream)) {
        spotter.decode(stream);
      }
      const result: KeywordResult = spotter.getResult(stream);
      if (!result.keyword) return false;
      spotter.reset(stream);
      return true;
    },
  };
}
