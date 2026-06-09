import fs from 'node:fs';
import { imageMimeType } from '@/lib/file-types';

/**
 * Largest image we will inline as a base64 data URI. base64 inflates bytes by
 * ~33% and the encoded string is held in the tRPC cache and component state, so
 * this stays well below memory-jank territory for doc screenshots.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Read an image file and return it as a `data:` URI suitable for an `<img src>`.
 * `displayPath` is the user-facing path used for the extension/MIME lookup and
 * error messages; `absPath` is the resolved, validated filesystem path to read.
 */
export function readImageAsDataUri(absPath: string, displayPath: string): string {
  const mime = imageMimeType(displayPath);
  if (!mime) {
    throw new Error(`Not a supported image: ${displayPath}`);
  }
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${displayPath}`);
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    const mb = Math.round(stat.size / (1024 * 1024));
    throw new Error(`Image too large to preview (${mb}MB, max 10MB): ${displayPath}`);
  }
  const base64 = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${base64}`;
}
