import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDb } from '../db/client';
import { buildWavHeader, createPcmDumpWriter } from './pcm-dump';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-pcm-dump-test-'));
  process.env.ENGY_DIR = tmpDir;
  resetDb();
});

afterEach(() => {
  delete process.env.ENGY_VOICE_DUMP;
  delete process.env.ENGY_DIR;
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readWavHeader(buf: Buffer) {
  return {
    riff: buf.toString('ascii', 0, 4),
    chunkSize: buf.readUInt32LE(4),
    wave: buf.toString('ascii', 8, 12),
    fmt: buf.toString('ascii', 12, 16),
    fmtChunkSize: buf.readUInt32LE(16),
    audioFormat: buf.readUInt16LE(20),
    numChannels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    blockAlign: buf.readUInt16LE(32),
    bitsPerSample: buf.readUInt16LE(34),
    data: buf.toString('ascii', 36, 40),
    dataSize: buf.readUInt32LE(40),
  };
}

describe('buildWavHeader', () => {
  it('produces a correct 44-byte 16kHz mono s16le header for a known data size', () => {
    const header = buildWavHeader(1000);

    expect(header.length).toBe(44);
    expect(readWavHeader(header)).toEqual({
      riff: 'RIFF',
      chunkSize: 36 + 1000,
      wave: 'WAVE',
      fmt: 'fmt ',
      fmtChunkSize: 16,
      audioFormat: 1,
      numChannels: 1,
      sampleRate: 16_000,
      byteRate: 32_000,
      blockAlign: 2,
      bitsPerSample: 16,
      data: 'data',
      dataSize: 1000,
    });
  });
});

describe('createPcmDumpWriter', () => {
  describe('when ENGY_VOICE_DUMP is unset', () => {
    it('is completely inert: no file I/O for write() or finish()', () => {
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
      const writeFileSpy = vi.spyOn(fs, 'writeFileSync');

      const writer = createPcmDumpWriter();
      writer.write(Buffer.from([1, 2, 3, 4]));
      writer.finish();

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(writeFileSpy).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpDir, 'voice-dumps'))).toBe(false);

      mkdirSpy.mockRestore();
      writeFileSpy.mockRestore();
    });
  });

  describe('when ENGY_VOICE_DUMP=1', () => {
    beforeEach(() => {
      process.env.ENGY_VOICE_DUMP = '1';
    });

    it('writes a valid WAV file with the exact PCM bytes it was given', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const chunkA = Buffer.from([1, 2, 3, 4]);
      const chunkB = Buffer.from([5, 6, 7, 8]);
      const writer = createPcmDumpWriter();
      writer.write(chunkA);
      writer.write(chunkB);
      writer.finish();

      const dumpDir = path.join(tmpDir, 'voice-dumps');
      const files = fs.readdirSync(dumpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^voice-.*\.wav$/);

      const written = fs.readFileSync(path.join(dumpDir, files[0]));
      const expectedPcm = Buffer.concat([chunkA, chunkB]);
      expect(written.length).toBe(44 + expectedPcm.length);
      expect(readWavHeader(written).dataSize).toBe(expectedPcm.length);
      expect(written.subarray(44)).toEqual(expectedPcm);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join(dumpDir, files[0])),
      );
      logSpy.mockRestore();
    });

    it('does not write a file when finish() is called with no chunks', () => {
      const writer = createPcmDumpWriter();
      writer.finish();

      expect(fs.existsSync(path.join(tmpDir, 'voice-dumps'))).toBe(false);
    });
  });
});
