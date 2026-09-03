import { createRequire } from 'node:module';
import type {
  OfflineRecognizer as OfflineRecognizerClass,
  OfflineRecognizerConfig,
  OfflineStream,
  Vad as VadClass,
  VadConfig,
} from 'sherpa-onnx-node';

import { resolveModelDir, resolveVadModelPath } from './models';
import { createWakeStream, preloadSpotter, type WakeStream } from './spotter';

// sherpa-onnx-node's CommonJS exports are invisible to Node's ESM lexer; a
// named import passes under Vitest's interop but throws in the real server.
const { OfflineRecognizer, Vad } = createRequire(import.meta.url)('sherpa-onnx-node') as {
  OfflineRecognizer: new (config: OfflineRecognizerConfig) => OfflineRecognizerClass;
  Vad: new (config: VadConfig, bufferSizeInSeconds?: number) => VadClass;
};
type OfflineRecognizer = OfflineRecognizerClass;
type Vad = VadClass;

const SAMPLE_RATE = 16_000;

// minSilenceDuration dominates segment-close latency — the main knob for
// responsiveness vs. the risk of splitting a segment mid-sentence.
const VAD_THRESHOLD = 0.5;
const VAD_MIN_SILENCE_DURATION_S = 0.2;
const VAD_MIN_SPEECH_DURATION_S = 0.2;
const VAD_MAX_SPEECH_DURATION_S = 8;
const VAD_BUFFER_SECONDS = 30;

export interface TurnRecognizerOpts {
  /** Called once per finalized, VAD-closed speech segment, in order. Not a
   * revision of a growing hypothesis — each call is complete decoded text
   * for its own span of audio. Every segment is decoded and reported,
   * regardless of the wake word — the key hold is already the deliberate
   * gesture a wake word would otherwise authorise (FR-TG2.12). `wake`
   * reports whether the wake word fired anywhere within this segment's
   * span, leaving the dictation-vs-command routing decision to the caller. */
  onSegment: (text: string, wake: boolean) => void;
  /** Called the moment the wake word is detected, independently of segment
   * decode — this is what lets the browser show "it heard me" even before
   * (or if never) a segment closes and resolves. See FR-TG2.15. */
  onWake: () => void;
  onError: (error: Error) => void;
}

export interface TurnRecognizer {
  writeChunk(chunk: Buffer): void;
  /** Flushes any trailing segment that never closed on silence and decodes
   * it (synchronously, via the same onSegment callback) before returning. */
  close(): void;
}

let sharedRecognizer: OfflineRecognizer | null = null;
let sharedRecognizerPromise: Promise<OfflineRecognizer> | null = null;

async function loadRecognizer(): Promise<OfflineRecognizer> {
  const dir = await resolveModelDir();
  const recognizer = new OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: `${dir}/encoder.int8.onnx`,
        decoder: `${dir}/decoder.int8.onnx`,
        joiner: `${dir}/joiner.int8.onnx`,
      },
      tokens: `${dir}/tokens.txt`,
      modelType: 'nemo_transducer',
      numThreads: 4,
      provider: 'cpu',
    },
  });
  sharedRecognizer = recognizer;
  return recognizer;
}

// Loaded once (~2.5s) and reused across turns — each turn gets its own
// OfflineStream, created fresh at decode time, which is the isolation
// boundary between concurrent callers.
async function getSharedRecognizer(): Promise<OfflineRecognizer> {
  if (sharedRecognizer) return sharedRecognizer;
  if (!sharedRecognizerPromise) {
    sharedRecognizerPromise = loadRecognizer().catch((err) => {
      sharedRecognizerPromise = null;
      throw err;
    });
  }
  return sharedRecognizerPromise;
}

/**
 * Kicks off the model download and load at the moment a workspace opts into
 * voice, rather than on the user's first keypress. Errors are swallowed here
 * — `createTurnRecognizer` awaits the same in-flight work and surfaces any
 * failure there.
 */
export function preloadRecognizer(): void {
  void getSharedRecognizer().catch(() => {});
  void resolveVadModelPath().catch(() => {});
  preloadSpotter();
}

function pcm16ToFloat32(chunk: Buffer): Float32Array {
  const sampleCount = Math.floor(chunk.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = chunk.readInt16LE(i * 2) / 32_768;
  }
  return samples;
}

// A Vad instance is stateful (segments queue up until drained), so each turn
// gets its own rather than reset()-ing a shared one — simpler isolation
// between concurrent connections, at the cost of reloading the (644KB) VAD
// model per turn.
async function createVad(): Promise<Vad> {
  const model = await resolveVadModelPath();
  return new Vad(
    {
      sileroVad: {
        model,
        threshold: VAD_THRESHOLD,
        minSilenceDuration: VAD_MIN_SILENCE_DURATION_S,
        minSpeechDuration: VAD_MIN_SPEECH_DURATION_S,
        maxSpeechDuration: VAD_MAX_SPEECH_DURATION_S,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
    },
    VAD_BUFFER_SECONDS,
  );
}

/**
 * Creates a per-turn recognizer against the shared, lazily-loaded
 * OfflineRecognizer and a fresh per-turn Vad. Feed it raw 16 kHz s16le mono
 * PCM via `writeChunk`; each VAD-closed segment is decoded and emitted via
 * `onSegment` while the turn is still in progress.
 */
export async function createTurnRecognizer(opts: TurnRecognizerOpts): Promise<TurnRecognizer> {
  const [recognizer, vad, wakeStream]: [OfflineRecognizer, Vad, WakeStream] = await Promise.all([
    getSharedRecognizer(),
    createVad(),
    createWakeStream(),
  ]);
  let closed = false;
  // True once the wake word has fired since the currently-open VAD segment
  // started (or since the last segment was drained, if none is open yet).
  // The VAD decides *what span* a segment covers; this only decides what
  // `wake` reports for it — decoding itself is unconditional (FR-TG2.12).
  let wokenSinceLastSegment = false;

  function decodeSegment(samples: Float32Array, wake: boolean): void {
    try {
      const stream: OfflineStream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
      recognizer.decode(stream);
      const text = recognizer.getResult(stream).text.trim();
      if (text) opts.onSegment(text, wake);
    } catch (err) {
      opts.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function drainClosedSegments(): void {
    while (!vad.isEmpty()) {
      const segment = vad.front();
      const woken = wokenSinceLastSegment;
      wokenSinceLastSegment = false;
      decodeSegment(segment.samples, woken);
      vad.pop();
    }
  }

  return {
    writeChunk(chunk: Buffer): void {
      if (closed) return;
      vad.acceptWaveform(pcm16ToFloat32(chunk));
      if (wakeStream.writeChunk(chunk)) {
        wokenSinceLastSegment = true;
        opts.onWake();
      }
      drainClosedSegments();
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (wakeStream.flush()) {
        wokenSinceLastSegment = true;
        opts.onWake();
      }
      vad.flush();
      drainClosedSegments();
    },
  };
}
