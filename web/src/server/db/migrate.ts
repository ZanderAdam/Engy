import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from './client';
import { workspaces } from './schema';
import { needsM7Backfill, backfillM7 } from '../engy-dir/backfill-m7';
import { getWorkspaceDir } from '../engy-dir/init';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runMigrations() {
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
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
