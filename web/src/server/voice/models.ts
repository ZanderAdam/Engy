import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  downloadFile,
  modelsRootDir,
  resolveArchiveModelDir,
  type ArchiveModel,
} from './model-store';

const MODEL_NAME = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';

const ASR_MODEL: ArchiveModel = {
  name: MODEL_NAME,
  url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`,
  requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
};

// Silero VAD ships as a bare .onnx file on the same release, not a tarball.
const VAD_MODEL_FILENAME = 'silero_vad.onnx';
const VAD_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${VAD_MODEL_FILENAME}`;

/** Resolves the local directory for the offline ASR model. */
export async function resolveModelDir(): Promise<string> {
  return resolveArchiveModelDir(ASR_MODEL);
}

async function downloadVadModel(target: string): Promise<string> {
  if (fs.existsSync(target)) return target;

  const root = modelsRootDir();
  fs.mkdirSync(root, { recursive: true });

  // Same atomic staging-then-rename approach as the archived models, minus
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
