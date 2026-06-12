import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertJournalSync } from './migrate';

describe('assertJournalSync', () => {
  let tmpDir: string;
  let migrationsFolder: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    migrationsFolder = path.join(tmpDir, 'migrations');
    fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
    dbPath = path.join(tmpDir, 'engy.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJournal(entries: Array<{ tag: string; when: number }>): void {
    fs.writeFileSync(
      path.join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
    );
  }

  function writeMigrationFile(tag: string, sql: string): string {
    const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
    fs.writeFileSync(sqlPath, sql);
    return crypto.createHash('sha256').update(sql).digest('hex');
  }

  function seedDbWithHash(hash: string, createdAt: number): void {
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )`,
    );
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
      hash,
      createdAt,
    );
    db.close();
  }

  describe('clean journal', () => {
    it('should pass when DB has no migration table yet (fresh DB)', () => {
      const tag = '0000_init';
      const when = 1000000;
      writeJournal([{ tag, when }]);
      writeMigrationFile(tag, 'CREATE TABLE foo (id INTEGER);');

      // DB exists but has no __drizzle_migrations table
      new Database(dbPath).close();

      expect(() => assertJournalSync(migrationsFolder, dbPath)).not.toThrow();
    });

    it('should pass when DB does not exist yet', () => {
      writeJournal([{ tag: '0000_init', when: 1000000 }]);
      writeMigrationFile('0000_init', 'CREATE TABLE foo (id INTEGER);');

      expect(() => assertJournalSync(migrationsFolder, dbPath)).not.toThrow();
    });

    it('should pass when all DB hashes match their migration files', () => {
      const tag = '0000_init';
      const when = 1000000;
      writeJournal([{ tag, when }]);
      const hash = writeMigrationFile(tag, 'CREATE TABLE foo (id INTEGER);');
      seedDbWithHash(hash, when);

      expect(() => assertJournalSync(migrationsFolder, dbPath)).not.toThrow();
    });

    it('should pass when no journal file exists', () => {
      // No journal written — assertJournalSync should return early
      new Database(dbPath).close();

      expect(() => assertJournalSync(migrationsFolder, dbPath)).not.toThrow();
    });
  });

  describe('desynced journal', () => {
    it('should throw when a DB hash does not match the migration file', () => {
      const tag = '0000_init';
      const when = 1000000;
      writeJournal([{ tag, when }]);
      writeMigrationFile(tag, 'CREATE TABLE foo (id INTEGER);');
      // Seed a DIFFERENT hash (simulates regenerated migration)
      seedDbWithHash('deadbeefdeadbeefdeadbeef', when);

      expect(() => assertJournalSync(migrationsFolder, dbPath)).toThrow(
        'Migration journal desync',
      );
    });

    it('should name the orphaned entry in the error message', () => {
      const tag = '0000_init';
      const when = 1700000000000;
      writeJournal([{ tag, when }]);
      writeMigrationFile(tag, 'CREATE TABLE foo (id INTEGER);');
      seedDbWithHash('orphan_hash_prefix', when);

      let errorMessage = '';
      try {
        assertJournalSync(migrationsFolder, dbPath);
      } catch (err) {
        errorMessage = (err as Error).message;
      }

      expect(errorMessage).toContain('orphan_hash');
      expect(errorMessage).toContain(String(when));
    });

    it('should include recovery instructions in the error', () => {
      const tag = '0000_init';
      const when = 1000000;
      writeJournal([{ tag, when }]);
      writeMigrationFile(tag, 'CREATE TABLE foo (id INTEGER);');
      seedDbWithHash('badhash', when);

      let errorMessage = '';
      try {
        assertJournalSync(migrationsFolder, dbPath);
      } catch (err) {
        errorMessage = (err as Error).message;
      }

      expect(errorMessage).toContain('Recovery options');
      expect(errorMessage).toContain('git history');
    });

    it('should not throw when DB has extra rows with unknown timestamps', () => {
      const tag = '0000_init';
      const when = 1000000;
      writeJournal([{ tag, when }]);
      const hash = writeMigrationFile(tag, 'CREATE TABLE foo (id INTEGER);');
      seedDbWithHash(hash, when);
      // Seed a row with a timestamp not in the journal (unknown — drizzle skips it)
      const db = new Database(dbPath);
      db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
        'unknownhash',
        9999999,
      );
      db.close();

      expect(() => assertJournalSync(migrationsFolder, dbPath)).not.toThrow();
    });
  });
});
