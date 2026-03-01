import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import * as clientModule from '../db/client.js';
import { createAppState, type AppState } from './context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestContext {
  db: ReturnType<typeof drizzle<typeof schema>>;
  state: AppState;
  tmpDir: string;
  cleanup: () => void;
}

export function setupTestDb(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-test-'));
  const dbPath = path.join(tmpDir, 'engy.db');

  process.env.ENGY_DIR = tmpDir;
  (clientModule as { resetDb: () => void }).resetDb();

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '../db/migrations') });

  const state = createAppState();

  return {
    db,
    state,
    tmpDir,
    cleanup: () => {
      sqlite.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.ENGY_DIR;
      (clientModule as { resetDb: () => void }).resetDb();
    },
  };
}
