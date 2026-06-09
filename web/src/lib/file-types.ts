const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

function extensionOf(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True when the path names a browser-previewable image (by extension). */
export function isImagePath(filePath: string): boolean {
  return imageMimeType(filePath) !== null;
}

/** MIME type for a previewable image path, or null if the extension is not a supported image. */
export function imageMimeType(filePath: string): string | null {
  return IMAGE_MIME[extensionOf(filePath)] ?? null;
}
