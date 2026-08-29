import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  KeywordSpotter as KeywordSpotterClass,
  KeywordSpotterConfig,
  KeywordResult,
} from 'sherpa-onnx-node';

import { resolveKwsModelDir } from './kws-models';
import { DEFAULT_WAKE_WORD, encodeWakeWord } from './keywords';

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

// Measured against 48 synthesized "Engy" clips (espeak-ng TTS — no real
// recordings of the wake word exist yet) and 135 real, wake-word-free
// recordings: false accepts were 0/135 at every threshold/boost tried, but
// so was accept rate at every practical setting except this one (1/48). Not
// a validated-safe operating point — see the task report for the full sweep.
const KEYWORDS_THRESHOLD = 0.35;
const KEYWORDS_SCORE = 3.0;

async function ensureKeywordsFile(kwsModelDir: string): Promise<string> {
  const keywordsPath = path.join(kwsModelDir, `keywords-${DEFAULT_WAKE_WORD}.txt`);
  try {
    await fs.access(keywordsPath);
    return keywordsPath;
  } catch {
    // Not written yet — encode it below.
  }
  const line = await encodeWakeWord(DEFAULT_WAKE_WORD, kwsModelDir);
  await fs.writeFile(keywordsPath, `${line}\n`, 'utf8');
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
