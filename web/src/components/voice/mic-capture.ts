// Lazy mic capture: requests getUserMedia on first start(), wires it into an
// AudioWorklet that posts 20 ms s16le 16 kHz mono chunks back, and stops every
// track on stop() so the OS-level "mic in use" indicator turns off.

export interface MicCaptureOpts {
  workletUrl: string;
  onChunk: (chunk: ArrayBuffer) => void;
  onError: (err: Error) => void;
}

export class MicCapture {
  private opts: MicCaptureOpts;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;

  constructor(opts: MicCaptureOpts) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this._startInternal().catch((e) => {
      this.starting = null;
      throw e;
    });
    return this.starting;
  }

  private async _startInternal(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia not available (insecure context?)');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    });
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule(this.opts.workletUrl);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'downsample-16k');
      node.port.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.opts.onChunk(e.data);
      };
      source.connect(node);
      // We don't connect node to destination — we don't want to hear the mic.

      // Awaiting getUserMedia's permission prompt consumes user-gesture
      // activation, so the context can come back suspended — resume explicitly.
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') {
        throw new Error(`audio context did not resume (state: ${ctx.state})`);
      }

      this.stream = stream;
      this.ctx = ctx;
      this.node = node;
    } catch (err) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {}
      }
      try {
        await ctx.close();
      } catch {}
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.onError(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.starting = null;
    if (this.node) {
      try {
        this.node.disconnect();
      } catch {}
      this.node.port.onmessage = null;
      this.node = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try {
          t.stop();
        } catch {}
      }
      this.stream = null;
    }
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {}
      this.ctx = null;
    }
  }
}
