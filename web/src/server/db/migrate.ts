import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { getDb, getEngyDir } from './client';
import { workspaces } from './schema';
import { needsM7Backfill, backfillM7 } from '../engy-dir/backfill-m7';
import { getWorkspaceDir } from '../engy-dir/init';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Computes the sha256 hash of a migration file's SQL content — matching
 * the algorithm drizzle-orm uses when inserting into __drizzle_migrations.
 */
function hashMigrationFile(sqlPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(sqlPath, 'utf8')).digest('hex');
}

/**
 * Cross-checks the DB migration journal against migration files on disk.
 * Throws a descriptive error if any recorded hash has no matching file —
 * which means a migration was regenerated after it ran, leaving the schema
 * silently incomplete (e.g. missing `permanent_memories`/`frontmatter` tables).
 *
 * Recovery options:
 *  1. Restore the missing migration file(s) from git history.
 *  2. If this is a dev DB, delete it and let migrations run fresh.
 *  3. Manually DELETE the orphaned rows from __drizzle_migrations (expert only).
 */
export function assertJournalSync(migrationsFolder: string, dbPath: string): void {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) return;
  if (!fs.existsSync(dbPath)) return;

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };

  const fileHashesByMillis = new Map<number, Set<string>>();
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const hash = hashMigrationFile(sqlPath);
    const existing = fileHashesByMillis.get(entry.when);
    if (existing) {
      existing.add(hash);
    } else {
      fileHashesByMillis.set(entry.when, new Set([hash]));
    }
  }

  // Open a separate read-only connection so we don't interfere with the main DB singleton.
  const sqlite = new Database(dbPath, { readonly: true });
  let dbRows: Array<{ hash: string; created_at: number }> = [];
  try {
    const tableExists = sqlite
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
      )
      .get();
    if (tableExists) {
      dbRows = sqlite
        .prepare('SELECT hash, created_at FROM __drizzle_migrations')
        .all() as typeof dbRows;
    }
  } finally {
    sqlite.close();
  }

  const orphans: string[] = [];
  for (const row of dbRows) {
    const expectedHashes = fileHashesByMillis.get(Number(row.created_at));
    if (expectedHashes === undefined) continue; // timestamp not in journal — drizzle will skip it
    if (!expectedHashes.has(row.hash)) {
      orphans.push(`  recorded hash ${row.hash.slice(0, 12)}… (created_at=${row.created_at})`);
    }
  }

  if (orphans.length > 0) {
    throw new Error(
      `[db] Migration journal desync — the following DB entries do not match any migration ` +
        `file on disk:\n${orphans.join('\n')}\n\n` +
        `This usually means a migration was regenerated after it already ran.\n` +
        `Recovery options:\n` +
        `  1. Restore the missing migration file(s) from git history.\n` +
        `  2. If this is a dev DB, delete ${dbPath} and let migrations run fresh.\n` +
        `  3. Manually DELETE the orphaned rows from __drizzle_migrations (expert only).`,
    );
  }
}

export function runMigrations() {
  const migrationsFolder = path.join(__dirname, 'migrations');
  const dbPath = path.join(getEngyDir(), 'engy.db');
  assertJournalSync(migrationsFolder, dbPath);
  const db = getDb();
  migrate(db, { migrationsFolder });
  console.log('[db] Migrations applied successfully');
}

export async function runPostMigrationBackfills(): Promise<void> {
  const db = getDb();
  const allWorkspaces = db.select().from(workspaces).all();
  for (const ws of allWorkspaces) {
    const wsDir = getWorkspaceDir(ws);
    if (needsM7Backfill(wsDir)) {
      console.log(`[db] Running M7 backfill for workspace: ${ws.slug}`);
      try {
        await backfillM7(ws.slug);
      } catch (err) {
        console.error(`[db] M7 backfill failed for ${ws.slug}:`, err);
      }
    }
  }
}
