import type { ReadingChapter } from '@/lib/review-summary-meta';
import { stepInList } from './review-nav';

export const OTHER_GROUP_ID = 'other';

export interface GuideGroup<T extends { path: string }> {
  id: string;
  number: number;
  chapter: ReadingChapter | null;
  files: T[];
}

export function groupByChapters<T extends { path: string }>(
  files: T[],
  chapters: ReadingChapter[],
): GuideGroup<T>[] {
  if (chapters.length === 0) return [];

  const claimed = new Set<string>();
  const groups: GuideGroup<T>[] = [];
  chapters.forEach((chapter, index) => {
    const groupFiles: T[] = [];
    for (const path of chapter.files) {
      if (claimed.has(path)) continue;
      claimed.add(path);
      groupFiles.push(...files.filter((f) => f.path === path));
    }
    if (groupFiles.length === 0) return;
    groups.push({ id: `chapter-${index}`, number: groups.length + 1, chapter, files: groupFiles });
  });

  const unlisted = files.filter((f) => !claimed.has(f.path));
  if (unlisted.length > 0) {
    groups.push({ id: OTHER_GROUP_ID, number: groups.length + 1, chapter: null, files: unlisted });
  }
  return groups;
}

export function stepGroup<T extends { path: string }>(
  groups: GuideGroup<T>[],
  currentPath: string | null,
  delta: 1 | -1,
): string | null {
  const current = groups.find((g) => g.files.some((f) => f.path === currentPath)) ?? null;
  return stepInList(groups, current, delta)?.files[0]?.path ?? null;
}
