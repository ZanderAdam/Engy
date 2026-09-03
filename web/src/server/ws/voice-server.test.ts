import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { getDb, resetDb } from '../db/client';
import { workspaces } from '../db/schema';
import { runMigrations } from '../db/migrate';
import {
  createTurnRecognizer,
  type TurnRecognizer,
  type TurnRecognizerOpts,
} from '../voice/recognizer';
import { createVoiceWebSocketServer } from './voice-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../voice/fixture.wav');
// 20ms at 16kHz s16le mono — matches the browser audio-worklet's chunk framing.
const CHUNK_BYTES = 640;
const SAMPLE_RATE = 16_000;
// First run downloads and extracts a ~631MB model archive; later runs reuse
// the cached directory under ENGY_DIR and are fast.
const MODEL_TEST_TIMEOUT = 120_000;

// Same fixed, non-prod ENGY_DIR as src/server/voice/recognizer.test.ts, so both
// suites share the once-downloaded model cache instead of re-fetching it.
const TEST_ENGY_DIR = path.join(os.tmpdir(), 'engy-voice-test');
const ENABLED_SLUG = 'voice-on';
const DISABLED_SLUG = 'voice-off';

const recognizerCloseSpies: ReturnType<typeof vi.fn>[] = [];

// This suite tests the WS layer — connection isolation, buffering, timing —
// not wake-word acoustics (that's spotter.test.ts's job, against the real
// model), so the wake signal is a controllable double rather than the real
// KeywordSpotter. Defaulting to "always woken" reproduces the original
// always-decode behaviour for tests that don't care about it; the
// wake-specific tests below flip it explicitly.
let wakeOnChunk: (chunk: Buffer) => boolean = () => true;
vi.mock('../voice/spotter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../voice/spotter')>();
  return {
    ...actual,
    createWakeStream: vi.fn(async () => ({
      writeChunk: (chunk: Buffer) => wakeOnChunk(chunk),
      flush: () => false,
    })),
  };
});

vi.mock('../voice/recognizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../voice/recognizer')>();
  return {
    ...actual,
    createTurnRecognizer: vi.fn(async (opts: TurnRecognizerOpts): Promise<TurnRecognizer> => {
      const real = await actual.createTurnRecognizer(opts);
      const closeSpy = vi.fn(() => real.close());
      recognizerCloseSpies.push(closeSpy);
      return { writeChunk: (chunk: Buffer) => real.writeChunk(chunk), close: closeSpy };
    }),
  };
});

function readWavPcm16(filePath: string): Buffer {
  const buf = fs.readFileSync(filePath);
  const dataIdx = buf.indexOf('data');
  if (dataIdx < 0) throw new Error(`${filePath}: not a RIFF/WAVE file with a data chunk`);
  const dataSize = buf.readUInt32LE(dataIdx + 4);
  return buf.subarray(dataIdx + 8, dataIdx + 8 + dataSize);
}

let openClients: WebSocket[] = [];

function startServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    const wss = createVoiceWebSocketServer();
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function connectVoice(port: number, slug: string = ENABLED_SLUG): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/voice?workspace=${slug}`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/** Collects every `voice_*` control message received on `ws` into typed
 * buckets. `finals` records one entry per content-free `voice_final` — its
 * length is the number of turns the connection has seen end. `wakes` records
 * one entry per `voice_wake`, sent distinctly from `voice_segment` per
 * FR-TG2.15. `segmentWakes` records each `voice_segment`'s own `wake` flag,
 * in the same order as `segments` (FR-TG2.12). */
function collectEvents(ws: WebSocket) {
  const segments: string[] = [];
  const segmentWakes: boolean[] = [];
  const finals: true[] = [];
  const errors: string[] = [];
  const wakes: true[] = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf-8')) as {
      t: string;
      transcript?: string;
      wake?: boolean;
      message?: string;
    };
    if (msg.t === 'voice_segment' && msg.transcript) {
      segments.push(msg.transcript);
      segmentWakes.push(!!msg.wake);
    }
    if (msg.t === 'voice_final') finals.push(true);
    if (msg.t === 'voice_error' && msg.message) errors.push(msg.message);
    if (msg.t === 'voice_wake') wakes.push(true);
  });
  return { segments, segmentWakes, finals, errors, wakes };
}

function streamFixture(ws: WebSocket, pcm: Buffer): void {
  for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
    ws.send(pcm.subarray(offset, offset + CHUNK_BYTES));
  }
}

/** A promise plus externally-callable resolve/reject, for pinning exactly
 * when `createTurnRecognizer` settles in the buffering/stop-during-start tests. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A `TurnRecognizer` double that records writes/closes instead of talking to
 * the real (slow, model-backed) recognizer — used to make the start-race
 * tests deterministic and independent of model load time. */
function makeFakeRecognizer(): {
  rec: TurnRecognizer;
  writes: Buffer[];
  closeSpy: ReturnType<typeof vi.fn>;
} {
  const writes: Buffer[] = [];
  const closeSpy = vi.fn();
  const rec: TurnRecognizer = {
    writeChunk: (chunk: Buffer) => {
      writes.push(chunk);
    },
    close: closeSpy,
  };
  return { rec, writes, closeSpy };
}

function waitUntil(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timed out'));
      setTimeout(check, 50);
    };
    check();
  });
}

describe('voice WebSocket server', () => {
  let server: Server;
  let port: number;

  beforeAll(() => {
    process.env.ENGY_DIR = TEST_ENGY_DIR;
    resetDb();
    runMigrations();
    const db = getDb();
    db.delete(workspaces).run();
    db.insert(workspaces)
      .values([
        { name: ENABLED_SLUG, slug: ENABLED_SLUG, voiceEnabled: true },
        { name: DISABLED_SLUG, slug: DISABLED_SLUG, voiceEnabled: false },
      ])
      .run();
  });

  afterAll(() => {
    delete process.env.ENGY_DIR;
    resetDb();
  });

  beforeEach(async () => {
    openClients = [];
    recognizerCloseSpies.length = 0;
    wakeOnChunk = () => true;
    vi.mocked(createTurnRecognizer).mockClear();
    const result = await startServer();
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  it('[FR-TG1.9] refuses a turn for a workspace whose voice was switched off', async () => {
    const ws = await connectVoice(port, DISABLED_SLUG);
    const events = collectEvents(ws);

    ws.send(JSON.stringify({ t: 'voice_start' }));
    await vi.waitFor(() => expect(events.errors).toHaveLength(1));

    expect(events.errors[0]).toContain('not enabled');
    expect(createTurnRecognizer).not.toHaveBeenCalled();
  });

  it(
    'gives two concurrent connections independent segments, streamed as VAD closes them rather than batched at the end',
    async () => {
      const phrase = readWavPcm16(FIXTURE_PATH);
      const silenceGap = Buffer.alloc(SAMPLE_RATE * 2); // 1s of s16le silence
      const combined = Buffer.concat([phrase, silenceGap, phrase]);

      const wsA = await connectVoice(port);
      const wsB = await connectVoice(port);
      const eventsA = collectEvents(wsA);
      const eventsB = collectEvents(wsB);

      wsA.send(JSON.stringify({ t: 'voice_start' }));
      wsB.send(JSON.stringify({ t: 'voice_start' }));
      await waitUntil(() => vi.mocked(createTurnRecognizer).mock.results.length >= 2);

      // Only connection A ever receives audio.
      streamFixture(wsA, combined);

      // A segment must already have closed and been decoded before
      // voice_stop is even sent — proof this arrives mid-turn, not batched
      // at the end the way the old offline-decode-on-stop behaviour did.
      await waitUntil(() => eventsA.segments.length >= 1);

      wsA.send(JSON.stringify({ t: 'voice_stop' }));
      await waitUntil(() => eventsA.finals.length > 0);

      expect(eventsA.segments.length).toBeGreaterThanOrEqual(2);
      expect(eventsA.segments.every((text) => text.length > 0)).toBe(true);
      // B was never fed audio — nothing from A's utterance leaked into it.
      expect(eventsB.segments).toEqual([]);
      expect(eventsB.finals).toEqual([]);
    },
    MODEL_TEST_TIMEOUT,
  );

  it(
    'releases the recognizer when a connection drops mid-utterance',
    async () => {
      const pcm = readWavPcm16(FIXTURE_PATH);
      const ws = await connectVoice(port);

      ws.send(JSON.stringify({ t: 'voice_start' }));
      await waitUntil(() => recognizerCloseSpies.length >= 1);

      // Feed a partial utterance, then drop the connection without voice_stop.
      streamFixture(ws, pcm.subarray(0, pcm.length / 2));
      ws.close();

      await waitUntil(() => recognizerCloseSpies[0].mock.calls.length >= 1);

      expect(recognizerCloseSpies[0]).toHaveBeenCalledTimes(1);
    },
    MODEL_TEST_TIMEOUT,
  );

  it('emits voice_error instead of a silent close when the recognizer fails to initialise', async () => {
    vi.mocked(createTurnRecognizer).mockRejectedValueOnce(new Error('model load failed'));

    const ws = await connectVoice(port);
    const events = collectEvents(ws);

    ws.send(JSON.stringify({ t: 'voice_start' }));

    await waitUntil(() => events.errors.length > 0);

    expect(events.errors).toEqual(['model load failed']);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('buffers audio that arrives while the turn is still starting, and flushes it in order once ready', async () => {
    const { rec, writes } = makeFakeRecognizer();
    const gate = deferred<TurnRecognizer>();
    vi.mocked(createTurnRecognizer).mockImplementationOnce(() => gate.promise);

    const ws = await connectVoice(port);
    ws.send(JSON.stringify({ t: 'voice_start' }));
    await waitUntil(() => vi.mocked(createTurnRecognizer).mock.calls.length >= 1);

    // Binary frames arriving before createTurnRecognizer resolves — this is
    // the window that used to hit a null `recognizer` and get dropped.
    const chunkA = Buffer.from([1, 2, 3]);
    const chunkB = Buffer.from([4, 5, 6]);
    ws.send(chunkA);
    ws.send(chunkB);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toEqual([]);

    gate.resolve(rec);

    await waitUntil(() => writes.length >= 2);
    expect(writes).toEqual([chunkA, chunkB]);
  });

  it('honours a voice_stop that arrives while the recognizer is still starting', async () => {
    const { rec, writes, closeSpy } = makeFakeRecognizer();
    const gate = deferred<TurnRecognizer>();
    vi.mocked(createTurnRecognizer).mockImplementationOnce(() => gate.promise);

    const ws = await connectVoice(port);
    ws.send(JSON.stringify({ t: 'voice_start' }));
    await waitUntil(() => vi.mocked(createTurnRecognizer).mock.calls.length >= 1);

    ws.send(JSON.stringify({ t: 'voice_stop' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closeSpy).not.toHaveBeenCalled();

    gate.resolve(rec);

    await waitUntil(() => closeSpy.mock.calls.length >= 1);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // A frame arriving after the already-honoured stop must not reach a
    // recognizer that nothing will ever close.
    ws.send(Buffer.from([9, 9, 9]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toEqual([]);
  });

  it(
    '[FR-TG2.16] decodes and reports every segment even when the wake word never fires, but reports no voice_wake',
    async () => {
      wakeOnChunk = () => false;
      const pcm = readWavPcm16(FIXTURE_PATH);
      const ws = await connectVoice(port);
      const events = collectEvents(ws);

      ws.send(JSON.stringify({ t: 'voice_start' }));
      await waitUntil(() => vi.mocked(createTurnRecognizer).mock.calls.length >= 1);

      streamFixture(ws, pcm);
      ws.send(JSON.stringify({ t: 'voice_stop' }));
      await waitUntil(() => events.finals.length > 0);

      expect(events.segments.length).toBeGreaterThanOrEqual(1);
      expect(events.segmentWakes.every((wake) => wake === false)).toBe(true);
      expect(events.wakes).toEqual([]);
      expect(events.errors).toEqual([]);
    },
    MODEL_TEST_TIMEOUT,
  );

  it(
    '[FR-TG2.12] reports voice_segment.wake true for a segment whose span saw the wake word fire',
    async () => {
      // wakeOnChunk fires on every chunk in the default beforeEach setup.
      const pcm = readWavPcm16(FIXTURE_PATH);
      const ws = await connectVoice(port);
      const events = collectEvents(ws);

      ws.send(JSON.stringify({ t: 'voice_start' }));
      await waitUntil(() => vi.mocked(createTurnRecognizer).mock.calls.length >= 1);

      streamFixture(ws, pcm);
      ws.send(JSON.stringify({ t: 'voice_stop' }));
      await waitUntil(() => events.finals.length > 0);

      expect(events.segments.length).toBeGreaterThanOrEqual(1);
      expect(events.segmentWakes.every((wake) => wake === true)).toBe(true);
    },
    MODEL_TEST_TIMEOUT,
  );

  it(
    '[FR-TG2.15] reports voice_wake distinctly from, and ahead of, the decoded voice_segment',
    async () => {
      // wakeOnChunk fires on every chunk in the default beforeEach setup —
      // exactly what's needed here: assert voice_wake precedes voice_segment
      // for the very first segment, proving it's a separate signal rather
      // than folded into the segment payload.
      const pcm = readWavPcm16(FIXTURE_PATH);
      const ws = await connectVoice(port);
      const order: string[] = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString('utf-8')) as { t: string };
        order.push(msg.t);
      });

      ws.send(JSON.stringify({ t: 'voice_start' }));
      await waitUntil(() => vi.mocked(createTurnRecognizer).mock.calls.length >= 1);

      streamFixture(ws, pcm);
      ws.send(JSON.stringify({ t: 'voice_stop' }));
      await waitUntil(() => order.includes('voice_final'));

      const wakeIdx = order.indexOf('voice_wake');
      const segmentIdx = order.indexOf('voice_segment');
      expect(wakeIdx).toBeGreaterThanOrEqual(0);
      expect(segmentIdx).toBeGreaterThan(wakeIdx);
    },
    MODEL_TEST_TIMEOUT,
  );
});
