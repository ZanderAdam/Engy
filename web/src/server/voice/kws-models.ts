import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getEngyDir } from '../db/client';

const KWS_MODEL_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';

const KWS_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${KWS_MODEL_NAME}.tar.bz2`;

const REQUIRED_FILES = [
  'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  'tokens.txt',
  'bpe.model',
];

function modelsRootDir(): string {
  return path.join(getEngyDir(), 'models');
}

function isModelDirComplete(dir: string): boolean {
  return REQUIRED_FILES.every((file) => fs.existsSync(path.join(dir, file)));
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`voice model download failed: ${res.status} ${res.statusText} (${url})`);
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function downloadAndExtract(target: string): Promise<string> {
  if (isModelDirComplete(target)) return target;

  const root = modelsRootDir();
  fs.mkdirSync(root, { recursive: true });

  // Extract into a private staging directory, then atomically rename into
  // place — a concurrent caller never observes a half-extracted directory.
  const staging = path.join(root, `.download-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const archivePath = path.join(staging, 'model.tar.bz2');
    await downloadFile(KWS_MODEL_URL, archivePath);
    execFileSync('tar', ['xjf', archivePath, '-C', staging]);

    const extracted = path.join(staging, KWS_MODEL_NAME);
    if (!isModelDirComplete(extracted)) {
      throw new Error(`voice model archive for ${KWS_MODEL_NAME} extracted without expected files`);
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

let inflight: Promise<string> | null = null;

/**
 * Resolves the local directory for the keyword-spotting model, downloading
 * and extracting it under `{ENGY_DIR}/models/` (beside the offline ASR
 * model from `models.ts`) on first use. Idempotent: repeat calls, including
 * concurrent ones within this process, return the same directory without
 * re-downloading once it is present.
 */
export async function resolveKwsModelDir(): Promise<string> {
  const target = path.join(modelsRootDir(), KWS_MODEL_NAME);
  if (isModelDirComplete(target)) return target;
  if (!inflight) {
    inflight = downloadAndExtract(target).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
