import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getEngyDir } from '../db/client';

export interface ArchiveModel {
  /** Directory the archive extracts into, and the name it is stored under. */
  name: string;
  url: string;
  requiredFiles: string[];
}

export function modelsRootDir(): string {
  return path.join(getEngyDir(), 'models');
}

function isComplete(dir: string, requiredFiles: string[]): boolean {
  return requiredFiles.every((file) => fs.existsSync(path.join(dir, file)));
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`voice model download failed: ${res.status} ${res.statusText} (${url})`);
  }
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function downloadAndExtract(model: ArchiveModel, target: string): Promise<string> {
  if (isComplete(target, model.requiredFiles)) return target;

  const root = modelsRootDir();
  fs.mkdirSync(root, { recursive: true });

  // Extract into a private staging directory, then atomically rename into
  // place — a concurrent caller never observes a half-extracted directory.
  const staging = path.join(root, `.download-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const archivePath = path.join(staging, 'model.tar.bz2');
    await downloadFile(model.url, archivePath);
    execFileSync('tar', ['xjf', archivePath, '-C', staging]);

    const extracted = path.join(staging, model.name);
    if (!isComplete(extracted, model.requiredFiles)) {
      throw new Error(`voice model archive for ${model.name} extracted without expected files`);
    }

    try {
      fs.renameSync(extracted, target);
    } catch (err) {
      // Another caller already finished extracting into `target` first — use
      // theirs rather than treating this as an error.
      if (!isComplete(target, model.requiredFiles)) throw err;
    }
    return target;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const inflight = new Map<string, Promise<string>>();

/**
 * Resolves the local directory for an archived model, downloading and
 * extracting it under `{ENGY_DIR}/models/` on first use. Idempotent: repeat
 * calls, including concurrent ones within this process, return the same
 * directory without re-downloading once it is present.
 */
export async function resolveArchiveModelDir(model: ArchiveModel): Promise<string> {
  const target = path.join(modelsRootDir(), model.name);
  if (isComplete(target, model.requiredFiles)) return target;

  const pending = inflight.get(model.name);
  if (pending) return pending;

  const download = downloadAndExtract(model, target).finally(() => {
    inflight.delete(model.name);
  });
  inflight.set(model.name, download);
  return download;
}
