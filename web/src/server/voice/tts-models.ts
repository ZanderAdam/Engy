import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getEngyDir } from '../db/client';

// Piper, not Kokoro: measured on this hardware Kokoro-82M runs at RTF 0.7-1.3
// on CPU, which is too slow to answer with. The Piper voices in
// `@/lib/voice/voices` measure RTF 0.06-0.12 and load in ~1.7s each.
function archiveName(model: string): string {
  return `vits-piper-${model}`;
}

export function ttsModelFiles(model: string) {
  return { model: `${model}.onnx`, tokens: 'tokens.txt', dataDir: 'espeak-ng-data' } as const;
}

function modelsRootDir(): string {
  return path.join(getEngyDir(), 'models');
}

function isModelDirComplete(dir: string, model: string): boolean {
  return Object.values(ttsModelFiles(model)).every((entry) => fs.existsSync(path.join(dir, entry)));
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`TTS model download failed: ${res.status} ${res.statusText} (${url})`);
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function downloadAndExtract(model: string, target: string): Promise<string> {
  if (isModelDirComplete(target, model)) return target;

  const root = modelsRootDir();
  fs.mkdirSync(root, { recursive: true });

  // Extract into a private staging directory, then atomically rename into
  // place — a concurrent caller never observes a half-extracted directory.
  const staging = path.join(root, `.tts-download-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const archivePath = path.join(staging, 'model.tar.bz2');
    await downloadFile(
      `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${archiveName(model)}.tar.bz2`,
      archivePath,
    );
    execFileSync('tar', ['xjf', archivePath, '-C', staging]);

    const extracted = path.join(staging, archiveName(model));
    if (!isModelDirComplete(extracted, model)) {
      throw new Error(`TTS model archive for ${model} extracted without expected files`);
    }

    try {
      fs.renameSync(extracted, target);
    } catch (err) {
      // Another caller already finished extracting into `target` first — use
      // theirs rather than treating this as an error.
      if (!isModelDirComplete(target, model)) throw err;
    }
    return target;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const inFlight = new Map<string, Promise<string>>();

/** Downloads a Piper voice on first use and returns its directory.
 * Concurrent callers for the same voice share one download. */
export function resolveTtsModelDir(model: string): Promise<string> {
  const target = path.join(modelsRootDir(), archiveName(model));
  if (isModelDirComplete(target, model)) return Promise.resolve(target);

  let download = inFlight.get(model);
  if (!download) {
    download = downloadAndExtract(model, target).finally(() => inFlight.delete(model));
    inFlight.set(model, download);
  }
  return download;
}
