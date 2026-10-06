import path from 'node:path';

export function isPathInside(dir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
