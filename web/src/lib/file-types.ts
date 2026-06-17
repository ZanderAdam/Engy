const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

/**
 * Extensions rendered as plain text in the document editor. Markdown is handled
 * separately (rich editor); everything here gets the read/write text viewer.
 * Extensionless files (LICENSE, Dockerfile, Makefile, …) are also treated as text.
 */
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'text', 'log', 'rst', 'adoc', 'tex', 'bib',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'properties', 'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs',
  'php', 'swift', 'scala', 'r', 'lua', 'pl', 'dart', 'ex', 'exs', 'elm', 'clj',
  'cljs', 'hs', 'ml', 'fs', 'vb', 'asm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'cmd', 'sql', 'graphql', 'gql', 'proto', 'gradle', 'mk', 'dockerfile', 'makefile',
  'diff', 'patch', 'srt', 'vtt',
]);

/** Classification of a file for the document editor's rendering decision. */
type FileKind = 'markdown' | 'image' | 'text' | 'binary';

function extensionOf(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True when the path names a markdown document. */
export function isMarkdownPath(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return ext === 'md' || ext === 'markdown' || ext === 'mdx';
}

/** True when the path names a browser-previewable image (by extension). */
export function isImagePath(filePath: string): boolean {
  return imageMimeType(filePath) !== null;
}

/** MIME type for a previewable image path, or null if the extension is not a supported image. */
export function imageMimeType(filePath: string): string | null {
  return IMAGE_MIME[extensionOf(filePath)] ?? null;
}

/**
 * True when the path's content can be read and rendered as UTF-8 text
 * (markdown included). Extensionless files are assumed to be text.
 */
export function isTextPath(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return ext === '' || TEXT_EXTENSIONS.has(ext);
}

/**
 * Classify a file for rendering. Markdown wins over the generic text bucket so
 * it routes to the rich editor; images get the image preview; remaining text
 * extensions render in the plain-text viewer; anything else is binary.
 */
export function fileKind(filePath: string): FileKind {
  if (isMarkdownPath(filePath)) return 'markdown';
  if (isImagePath(filePath)) return 'image';
  if (isTextPath(filePath)) return 'text';
  return 'binary';
}
