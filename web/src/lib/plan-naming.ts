export const PLANS_DIR = 'plans';
const PLAN_EXT = '.plan.md';

// `<ws-slug>-T<id>` followed by the end of the stem or the description separator.
// The lazy quantifier stops `engy-T123-add-api-routing` matching at `engy-T12`.
const STEM_TASK_RE = /^(.+?-T(\d+))(?:-|$)/;

/** Stable task identifier, also the required prefix of a task's plan filename. */
export function taskPlanSlug(workspaceSlug: string, taskId: number): string {
  return workspaceSlug ? `${workspaceSlug}-T${taskId}` : '';
}

export function isPlanFile(filename: string): boolean {
  return filename.endsWith(PLAN_EXT);
}

export function planFilePathFromStem(stem: string): string {
  return `${PLANS_DIR}/${stem}${PLAN_EXT}`;
}

export function planStemFromFilename(filename: string): string {
  return filename.slice(0, -PLAN_EXT.length);
}

/** Plan stem inside a watched file-change path, or null when it is not a plan. */
export function planStemFromWatchedPath(filePath: string): string | null {
  if (!isPlanFile(filePath)) return null;
  const segments = filePath.split('/');
  const filename = segments.pop();
  if (!filename || segments.pop() !== PLANS_DIR) return null;
  return planStemFromFilename(filename);
}

export function taskSlugFromStem(stem: string): string {
  return stem.match(STEM_TASK_RE)?.[1] ?? stem;
}

/**
 * Task id a plan stem belongs to, or null when the stem names another
 * workspace's task or carries no id at all.
 */
export function taskIdFromStem(stem: string, workspaceSlug: string): number | null {
  if (!workspaceSlug) return null;
  const match = stem.match(STEM_TASK_RE);
  if (!match) return null;
  const [, slug, id] = match;
  return slug === `${workspaceSlug}-T${id}` ? Number(id) : null;
}

export function defaultTaskPlanFilename(taskSlug: string): string {
  return `${taskSlug}${PLAN_EXT}`;
}

/**
 * Prompt fragment telling a planning agent where to write. A replan reuses the
 * existing filename so plan comment threads (keyed by file path) stay attached.
 */
export function planOutputTarget(
  projectDir: string,
  taskSlug: string,
  existingPlanPath: string | null,
): string {
  if (existingPlanPath) return `${projectDir}/${existingPlanPath}`;
  return `${projectDir}/${PLANS_DIR}/${taskSlug}-<short-slug>${PLAN_EXT}, replacing <short-slug> with 2-5 kebab-case words describing the task`;
}
