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

  /** A streaming input handle shared by OnlineRecognizer and KeywordSpotter —
   * feed it waveform chunks as they arrive. */
  export class OnlineStream {
    acceptWaveform(waveform: Waveform): void;
    inputFinished(): void;
  }

  export interface KeywordSpotterConfig {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: OfflineModelConfig;
    maxActivePaths?: number;
    numTrailingBlanks?: number;
    /** Global boost applied to every keyword's LM score; overridden per-line
     * by a keywords-file entry's own `:boost`. */
    keywordsScore?: number;
    /** Global trigger threshold; overridden per-line by `#threshold`. */
    keywordsThreshold?: number;
    /** Path to a `sherpa-onnx` keywords-file (see `keywords.ts`'s
     * `formatKeywordLine`). */
    keywordsFile: string;
  }

  export interface KeywordResult {
    /** The "@id" field of the keywords-file line that fired, or `""` when no
     * keyword has fired since the stream was created or last `reset()`. */
    keyword: string;
    start_time: number;
    timestamps: number[];
    tokens: string[];
  }

  /** Streaming keyword spotter. Like OnlineRecognizer, the spotter instance
   * itself is stateless config wrapping the loaded model; all per-utterance
   * state (buffered frames, the armed/fired keyword) lives on the
   * OnlineStream from `createStream()`. */
  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    /** Clears the stream's fired keyword so a later utterance in the same
     * stream can trigger again. */
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): KeywordResult;
  }
}
