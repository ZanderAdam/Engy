const CHARS_PER_TOKEN = 3.6;

const IMAGE_LONG_EDGE_CAP = 1568;
const IMAGE_PIXELS_PER_TOKEN = 750;
const IMAGE_FALLBACK_TOKENS = 1500;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function estimateTextTokens(text: string): number {
  return text.length / CHARS_PER_TOKEN;
}

interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * PNG stores width/height as big-endian u32 at bytes 16..24 (IHDR). Only the
 * first 32 decoded bytes are needed, so we decode a short base64 prefix rather
 * than the whole (often multi-megabyte) payload.
 */
export function readPngDimensions(base64Data: string): ImageDimensions | null {
  const prefix = base64Data.slice(0, 64);
  if (prefix.length < 32) return null;

  let head: Buffer;
  try {
    head = Buffer.from(prefix, 'base64');
  } catch {
    return null;
  }
  if (head.length < 24 || !head.subarray(0, 8).equals(PNG_MAGIC)) return null;

  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

/**
 * Images are priced by pixel count, never by payload size: a base64 screenshot
 * runs to ~1.26M characters but bills ~1800 tokens. Estimating it as text
 * overstates it ~25x and inverts every cost ranking built on top.
 */
export function estimateImageTokens(base64Data: string): number {
  const dims = readPngDimensions(base64Data);
  if (!dims) return IMAGE_FALLBACK_TOKENS;

  const longEdge = Math.max(dims.width, dims.height);
  const scale = longEdge > IMAGE_LONG_EDGE_CAP ? IMAGE_LONG_EDGE_CAP / longEdge : 1;
  const pixels = dims.width * scale * (dims.height * scale);
  return Math.max(1, Math.round(pixels / IMAGE_PIXELS_PER_TOKEN));
}

interface BlockEstimate {
  tokens: number;
  isImage: boolean;
}

export function estimateBlockTokens(block: unknown): BlockEstimate {
  if (typeof block === 'string') return { tokens: estimateTextTokens(block), isImage: false };
  if (!block || typeof block !== 'object') return { tokens: 0, isImage: false };

  const rec = block as Record<string, unknown>;
  if (rec.type === 'image') {
    const source = rec.source as Record<string, unknown> | undefined;
    const data = typeof source?.data === 'string' ? source.data : '';
    return { tokens: estimateImageTokens(data), isImage: true };
  }
  if (rec.type === 'text' && typeof rec.text === 'string') {
    return { tokens: estimateTextTokens(rec.text), isImage: false };
  }
  return { tokens: estimateTextTokens(safeStringify(block)), isImage: false };
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
