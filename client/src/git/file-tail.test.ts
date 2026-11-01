import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getFileTail } from './index';

describe('getFileTail', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-tail-'));
    await writeFile(join(dir, 'log.jsonl'), 'first\nsecond\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('[FR-TERMINAL-1085] should return only the last bytes of the file', async () => {
    expect(await getFileTail(dir, 'log.jsonl', 7)).toBe('second\n');
  });

  it('should return the whole file when it is smaller than the limit', async () => {
    expect(await getFileTail(dir, 'log.jsonl', 1024)).toBe('first\nsecond\n');
  });
});
