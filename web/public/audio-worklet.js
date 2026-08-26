// AudioWorklet that downsamples device-rate Float32 mic audio to s16le 16 kHz
// mono and posts 20 ms chunks (320 samples = 640 bytes) to the main thread.
//
// Loaded by AudioContext.audioWorklet.addModule('/audio-worklet.js'). Served
// from web/public/ at /audio-worklet.js by Next.js.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 320; // 20 ms @ 16 kHz

class DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(CHUNK_SAMPLES);
    this._bufferIdx = 0;
    this._inputCursor = 0; // fractional read position into the input frame
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const inputRate = sampleRate; // global in AudioWorkletGlobalScope
    const step = inputRate / TARGET_RATE;

    let i = this._inputCursor;
    while (i < channel.length) {
      const idx = Math.floor(i);
      const frac = i - idx;
      const a = channel[idx];
      const b = idx + 1 < channel.length ? channel[idx + 1] : a;
      const sample = a + (b - a) * frac; // linear interpolation
      const clamped = Math.max(-1, Math.min(1, sample));
      this._buffer[this._bufferIdx++] =
        clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
      if (this._bufferIdx >= CHUNK_SAMPLES) {
        const out = new ArrayBuffer(CHUNK_SAMPLES * 2);
        new Int16Array(out).set(this._buffer);
        this.port.postMessage(out, [out]);
        this._bufferIdx = 0;
      }
      i += step;
    }
    // Carry remainder across blocks.
    this._inputCursor = i - channel.length;
    return true;
  }
}

registerProcessor("downsample-16k", DownsampleProcessor);
