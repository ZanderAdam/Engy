import fs from 'node:fs';
import path from 'node:path';

import { getEngyDir } from '../db/client';

const SAMPLE_RATE = 16_000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const WAV_HEADER_BYTES = 44;

/** Builds a canonical 44-byte RIFF/WAVE header for 16 kHz mono s16le PCM of `dataSize` bytes. */
export function buildWavHeader(dataSize: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const byteRate = SAMPLE_RATE * blockAlign;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size for PCM
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return header;
}

export interface PcmDumpWriter {
  /** Accumulates one chunk of raw PCM received for the current turn. */
  write(chunk: Buffer): void;
  /** Flushes the accumulated PCM to a timestamped .wav file and logs its path.
   * No-op if nothing was ever written. */
  finish(): void;
}

const inertWriter: PcmDumpWriter = {
  write() {},
  finish() {},
};

function dumpDir(): string {
  return path.join(getEngyDir(), 'voice-dumps');
}

function timestampedFilename(): string {
  return `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
}

class FileDumpWriter implements PcmDumpWriter {
  private chunks: Buffer[] = [];

  write(chunk: Buffer): void {
    this.chunks.push(chunk);
  }

  finish(): void {
    if (this.chunks.length === 0) return;
    const pcm = Buffer.concat(this.chunks);
    this.chunks = [];

    const dir = dumpDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, timestampedFilename());
    fs.writeFileSync(filePath, Buffer.concat([buildWavHeader(pcm.length), pcm]));
    console.log(`[voice] PCM dump written: ${filePath}`);
  }
}

/**
 * One writer per voice turn, for diagnosing capture quality independently of
 * recognizer quality. Returns a real file-backed writer only when
 * `ENGY_VOICE_DUMP=1` — otherwise a shared no-op, so the hot audio path pays
 * no buffering or file I/O cost when diagnostics are off.
 */
export function createPcmDumpWriter(): PcmDumpWriter {
  if (process.env.ENGY_VOICE_DUMP !== '1') return inertWriter;
  return new FileDumpWriter();
}
