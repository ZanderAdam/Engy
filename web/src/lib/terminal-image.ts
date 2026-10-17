export const TERMINAL_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const TERMINAL_IMAGE_ACCEPT = Object.keys(TERMINAL_IMAGE_EXTENSIONS).join(',');

export const TERMINAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function terminalImageError(mimeType: string, sizeBytes: number): string | null {
  if (!Object.hasOwn(TERMINAL_IMAGE_EXTENSIONS, mimeType)) {
    return `Unsupported image type "${mimeType || 'unknown'}". Use PNG, JPEG, GIF or WebP.`;
  }
  if (sizeBytes === 0) return 'The image is empty.';
  if (sizeBytes > TERMINAL_IMAGE_MAX_BYTES) {
    const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
    return `The image is ${sizeMb} MB. The limit is 5 MB.`;
  }
  return null;
}
