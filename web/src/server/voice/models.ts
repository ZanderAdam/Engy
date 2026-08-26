import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getEngyDir } from '../db/client';

const MODEL_NAME = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';

const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;

const REQUIRED_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'];

// Silero VAD ships as a bare .onnx file on the same release, not a tarball.
const VAD_MODEL_FILENAME = 'silero_vad.onnx';
const VAD_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${VAD_MODEL_FILENAME}`;

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
    await downloadFile(MODEL_URL, archivePath);
    execFileSync('tar', ['xjf', archivePath, '-C', staging]);

    const extracted = path.join(staging, MODEL_NAME);
    if (!isModelDirComplete(extracted)) {
      throw new Error(`voice model archive for ${MODEL_NAME} extracted without expected files`);
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
 * Resolves the local directory for the offline ASR model, downloading and
 * extracting it under `{ENGY_DIR}/models/` on first use. Idempotent: repeat
 * calls (including concurrent ones, within this process) return the same
 * directory without re-downloading once it is present.
 */
export async function resolveModelDir(): Promise<string> {
  const target = path.join(modelsRootDir(), MODEL_NAME);
  if (isModelDirComplete(target)) return target;
  if (!inflight) {
    inflight = downloadAndExtract(target).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function downloadVadModel(target: string): Promise<string> {
  if (fs.existsSync(target)) return target;

  const root = modelsRootDir();
  fs.mkdirSync(root, { recursive: true });

  // Same atomic staging-then-rename approach as downloadAndExtract, minus
  // the tar extraction step — this asset is already a bare .onnx file.
  const staging = path.join(root, `.download-${crypto.randomUUID()}.onnx`);
  try {
    await downloadFile(VAD_MODEL_URL, staging);
    try {
      fs.renameSync(staging, target);
    } catch (err) {
      if (!fs.existsSync(target)) throw err;
    }
    return target;
  } finally {
    fs.rmSync(staging, { force: true });
  }
}

let vadInflight: Promise<string> | null = null;

/**
 * Resolves the local path to the Silero VAD model, downloading it under
 * `{ENGY_DIR}/models/` on first use. Idempotent like `resolveModelDir`.
 */
export async function resolveVadModelPath(): Promise<string> {
  const target = path.join(modelsRootDir(), VAD_MODEL_FILENAME);
  if (fs.existsSync(target)) return target;
  if (!vadInflight) {
    vadInflight = downloadVadModel(target).finally(() => {
      vadInflight = null;
    });
  }
  return vadInflight;
}
