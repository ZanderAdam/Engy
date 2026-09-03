import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getEngyDir } from '../db/client';

// Piper, not Kokoro: measured on this hardware Kokoro-82M runs at RTF 0.7-1.3
// on CPU, which is too slow to answer with. This model measures RTF ~0.06
// (62ms for a 0.7s "Sent.", 322ms for a 5.7s status readout).
const TTS_MODEL_NAME = 'vits-piper-en_US-amy-low';

const TTS_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${TTS_MODEL_NAME}.tar.bz2`;

const REQUIRED_FILES = ['en_US-amy-low.onnx', 'tokens.txt'];
// espeak-ng-data is a directory, so it needs a different existence check.
const REQUIRED_DIRS = ['espeak-ng-data'];

function modelsRootDir(): string {
  return path.join(getEngyDir(), 'models');
}

function isModelDirComplete(dir: string): boolean {
  return (
    REQUIRED_FILES.every((file) => fs.existsSync(path.join(dir, file))) &&
    REQUIRED_DIRS.every((d) => fs.existsSync(path.join(dir, d)))
  );
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`TTS model download failed: ${res.status} ${res.statusText} (${url})`);
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function downloadAndExtract(target: string): Promise<string> {
  if (isModelDirComplete(target)) return target;

  const root = modelsRootDir();
  fs.mkdirSync(root, { recursive: true });

  // Extract into a private staging directory, then atomically rename into
  // place — a concurrent caller never observes a half-extracted directory.
  const staging = path.join(root, `.tts-download-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const archivePath = path.join(staging, 'model.tar.bz2');
    await downloadFile(TTS_MODEL_URL, archivePath);
    execFileSync('tar', ['xjf', archivePath, '-C', staging]);

    const extracted = path.join(staging, TTS_MODEL_NAME);
    if (!isModelDirComplete(extracted)) {
      throw new Error(`TTS model archive for ${TTS_MODEL_NAME} extracted without expected files`);
    }

    try {
      fs.renameSync(extracted, target);
    } catch (err) {
      // Another caller already finished extracting into `target` first — use
      // theirs rather than treating this as an error.
      if (!isModelDirComplete(target)) throw err;
    }
    return target;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

let inFlight: Promise<string> | null = null;

/** Downloads the Piper voice on first use and returns its directory.
 * Concurrent callers share one download. */
export function resolveTtsModelDir(): Promise<string> {
  const target = path.join(modelsRootDir(), TTS_MODEL_NAME);
  if (isModelDirComplete(target)) return Promise.resolve(target);

  inFlight ??= downloadAndExtract(target).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export const TTS_MODEL_FILES = {
  model: 'en_US-amy-low.onnx',
  tokens: 'tokens.txt',
  dataDir: 'espeak-ng-data',
} as const;
