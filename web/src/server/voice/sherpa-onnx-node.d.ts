// sherpa-onnx-node ships no type declarations (plain CommonJS + JSDoc). This
// shim covers only the offline OfflineRecognizer surface recognizer.ts uses,
// mirrored from the package's own JSDoc typedefs (types.js) and
// non-streaming-asr.js at version 1.13.6.
declare module 'sherpa-onnx-node' {
  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface OfflineTransducerModelConfig {
    encoder: string;
    decoder: string;
    joiner: string;
  }

  export interface OfflineModelConfig {
    transducer?: OfflineTransducerModelConfig;
    tokens: string;
    // Selects the NeMo transducer decoding path (undocumented in the
    // package's own JSDoc, but required by the native addon for a
    // NeMo-exported transducer such as parakeet — verified empirically).
    modelType?: string;
    numThreads?: number;
    provider?: string;
  }

  export interface OfflineRecognizerConfig {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: OfflineModelConfig;
  }

  export interface OfflineRecognizerResult {
    text: string;
    tokens: string[];
    timestamps: number[];
  }

  export class OfflineStream {
    acceptWaveform(waveform: Waveform): void;
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): OfflineRecognizerResult;
  }

  export interface SileroVadModelConfig {
    model: string;
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
    maxSpeechDuration?: number;
  }

  export interface VadConfig {
    sileroVad: SileroVadModelConfig;
    sampleRate: number;
    numThreads?: number;
    provider?: string;
  }

  export interface SpeechSegment {
    samples: Float32Array;
    start: number;
  }

  /** Silero VAD wrapper. Stateful — segments accumulate across
   * `acceptWaveform` calls until drained via `front()`/`pop()`, so each turn
   * needs its own instance (or an explicit `reset()` between turns). */
  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds?: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    front(): SpeechSegment;
    pop(): void;
    /** Forces any in-progress (not yet silence-closed) segment to become
     * available via front()/pop() — used at turn end to catch a trailing
     * segment that never crossed minSilenceDuration. */
    flush(): void;
    reset(): void;
  }
}
