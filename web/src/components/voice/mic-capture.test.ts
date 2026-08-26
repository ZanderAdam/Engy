// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MicCapture, type MicCaptureOpts } from './mic-capture';

class FakeMediaStreamTrack {
  stop = vi.fn();
}

class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[];
  constructor(tracks: FakeMediaStreamTrack[] = [new FakeMediaStreamTrack()]) {
    this.tracks = tracks;
  }
  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }
}

class FakeAudioWorkletNode {
  port: { onmessage: ((e: MessageEvent) => void) | null } = { onmessage: null };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    public ctx: unknown,
    public name: string,
  ) {}
}

class FakeMediaStreamSourceNode {
  connect = vi.fn();
}

type ResumeBehavior = 'toRunning' | 'staySuspended' | 'reject';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: AudioContextState = 'running';
  static resumeBehavior: ResumeBehavior = 'toRunning';

  state: AudioContextState;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {
    if (FakeAudioContext.resumeBehavior === 'reject') {
      throw new Error('resume blocked by browser policy');
    }
    if (FakeAudioContext.resumeBehavior === 'toRunning') {
      this.state = 'running';
    }
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createMediaStreamSource = vi.fn(() => new FakeMediaStreamSourceNode());

  constructor() {
    this.state = FakeAudioContext.initialState;
    FakeAudioContext.instances.push(this);
  }
}

let track: FakeMediaStreamTrack;
let getUserMedia: ReturnType<typeof vi.fn>;

function makeOpts(overrides: Partial<MicCaptureOpts> = {}): MicCaptureOpts {
  return {
    workletUrl: '/audio-worklet.js',
    onChunk: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.initialState = 'running';
  FakeAudioContext.resumeBehavior = 'toRunning';

  track = new FakeMediaStreamTrack();
  getUserMedia = vi.fn(async () => new FakeMediaStream([track]));

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MicCapture', () => {
  it('resumes a suspended AudioContext so the worklet actually receives audio', async () => {
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.resumeBehavior = 'toRunning';
    const opts = makeOpts();
    const mic = new MicCapture(opts);

    await mic.start();

    const ctx = FakeAudioContext.instances[0];
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    expect(opts.onError).not.toHaveBeenCalled();
  });

  it('does not call resume when the context already starts running', async () => {
    FakeAudioContext.initialState = 'running';
    const mic = new MicCapture(makeOpts());

    await mic.start();

    expect(FakeAudioContext.instances[0].resume).not.toHaveBeenCalled();
  });

  it('reports a hard failure through onError when resume cannot bring the context to running', async () => {
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.resumeBehavior = 'staySuspended';
    const opts = makeOpts();
    const mic = new MicCapture(opts);

    await expect(mic.start()).rejects.toThrow(/did not resume/);

    expect(opts.onError).toHaveBeenCalledTimes(1);
    expect((opts.onError as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
    // No dangling mic/AudioContext left behind after a failed start.
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('reports onError and cleans up when resume() itself rejects', async () => {
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.resumeBehavior = 'reject';
    const opts = makeOpts();
    const mic = new MicCapture(opts);

    await expect(mic.start()).rejects.toThrow('resume blocked by browser policy');

    expect(opts.onError).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
  });
});
