import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { commentThreads, threadComments } from './schema';
import { getDb } from './client';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { diffDocPath } from '@/lib/diff-doc-path';

const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
  '0033_drop_unscoped_diff_comments.sql',
);

const REPO = '/home/dev/proj';

describe('migration 0033: drop unscoped diff comments', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function insertThread(id: string, documentPath: string): void {
    const db = getDb();
    db.insert(commentThreads).values({ id, workspaceId: null, documentPath }).run();
    db.insert(threadComments)
      .values({ id: `${id}-c`, threadId: id, userId: 'local-user', body: 'stale finding' })
      .run();
  }

  // Migrations already ran against this DB, so the file is replayed over rows
  // seeded in the shape it exists to clean up.
  function runMigration(): void {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      getDb().$client.exec(statement);
    }
  }

  it('[FR-GIT-480] should delete threads stored without a branch', () => {
    insertThread('legacy', `diff://${REPO}/src/a.ts`);

    runMigration();

    expect(getDb().select().from(commentThreads).all()).toHaveLength(0);
    expect(getDb().select().from(threadComments).all()).toHaveLength(0);
  });

  it('[FR-GIT-480] should delete branch-scoped threads too, so no old format survives', () => {
    insertThread('scoped', diffDocPath(REPO, 'main', 'src/a.ts'));

    runMigration();

    expect(getDb().select().from(commentThreads).all()).toHaveLength(0);
  });

  it('[FR-GIT-480] should leave document comment threads untouched', () => {
    insertThread('doc', '/home/dev/proj/docs/notes.md');

    runMigration();

    const rows = getDb()
      .select()
      .from(commentThreads)
      .where(eq(commentThreads.id, 'doc'))
      .all();
    expect(rows).toHaveLength(1);
  });
});
