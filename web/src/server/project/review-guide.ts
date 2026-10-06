import fs from 'node:fs';
import path from 'node:path';

export const REVIEW_GUIDE_FILE = 'review-guide.md';

const DEFAULT_GUIDE_PATH = path.resolve(
  process.cwd(),
  '..',
  'plugins/engy/skills/review-diff/references/review-guide.md',
);

let cachedDefault: string | null = null;

export function readDefaultReviewGuide(): string {
  if (cachedDefault === null) {
    try {
      cachedDefault = fs.readFileSync(DEFAULT_GUIDE_PATH, 'utf-8');
    } catch (e) {
      throw new Error(
        `Default review guide not found at ${DEFAULT_GUIDE_PATH}. Run the server from the web/ directory of a full checkout. ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return cachedDefault;
}
