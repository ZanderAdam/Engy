import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import * as schema from './schema';

function resolveEngyDir(): string {
  const raw = process.env.ENGY_DIR || '~/.engy/';
  if (raw.startsWith('~')) {
    return path.join(os.homedir(), raw.slice(1));
  }
  return path.resolve(raw);
}

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let engyDirPath: string | null = null;

export function getEngyDir(): string {
  if (!engyDirPath) {
    engyDirPath = resolveEngyDir();
  }
  return engyDirPath;
}

export function getDb() {
  if (dbInstance) return dbInstance;

  const dir = getEngyDir();
  fs.mkdirSync(dir, { recursive: true });

  const dbPath = path.join(dir, 'engy.db');
  console.log(`[db] Resolved ENGY_DIR: ${dir}`);
  console.log(`[db] Database path: ${dbPath}`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

export function resetDb() {
  dbInstance = null;
  engyDirPath = null;
}
