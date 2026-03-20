const OPEN = '---\n';
const CLOSE = '\n---\n';

export function stripFrontmatter(content: string): { header: string; body: string } {
  if (!content.startsWith(OPEN)) return { header: '', body: content };
  // Search from OPEN.length - 1 so the closing delimiter's leading \n can overlap
  // with the opening delimiter's trailing \n for empty frontmatter: '---\n---\n'
  const closeIndex = content.indexOf(CLOSE, OPEN.length - 1);
  if (closeIndex === -1) return { header: '', body: content };
  const splitAt = closeIndex + CLOSE.length;
  return { header: content.slice(0, splitAt), body: content.slice(splitAt) };
}
