# DB Layer

Drizzle ORM + better-sqlite3. SQLite file at `{ENGY_DIR}/engy.db`, WAL mode, foreign keys ON.

## Workflow

- Edit `schema.ts` → run `cd web && pnpm drizzle-kit generate` → new migration appears in `migrations/`.
- **Never hand-edit** generated migration SQL. If the output is wrong, fix `schema.ts` and regenerate.
- **Never renumber, rename, or delete** a migration that has been merged. Migrations are forward-only.
- `migrate.ts` runs `runMigrations()` on server startup — no manual step.

## Schema rules

- Timestamps: `text('...').notNull().$defaultFn(() => new Date().toISOString())` — ISO strings, never `integer` epochs. Match the existing pattern.
- IDs: `integer('id').primaryKey({ autoIncrement: true })`.
- JSON columns: `text('col', { mode: 'json' }).$type<Shape>()`. Define `Shape` as a TS interface above the table and a matching zod schema in the router that accepts it. SQLite stores it as text — no querying inside the JSON.
- Booleans: `integer('col', { mode: 'boolean' })`.
- Enums: `text('col', { enum: [...] })` — keep the literal array narrow; widening is a migration.
- Foreign keys: always declare `.references(() => other.id, { onDelete: 'cascade' | 'set null' })`. SQLite does **not** auto-index FKs — add a `uniqueIndex` / index when the column is queried.

## Migration safety

- Adding a `NOT NULL` column to an existing table requires a default OR a two-step migration (nullable → backfill → NOT NULL). Drizzle Kit won't catch this for populated tables.
- Dropping or renaming a column on SQLite is a table rebuild — review the generated SQL carefully.
- Changing an enum's allowed values is a CHECK constraint change; existing rows must already satisfy the new set.
- Don't rely on cross-row constraints SQLite doesn't enforce (e.g., partial uniqueness across nullable cols) without an explicit `uniqueIndex`.

## DB access

- Always `getDb()` from `./client` per call site — never cache the handle across requests.
- `resetDb()` is for tests only (forces re-init against a fresh `ENGY_DIR`).
- Transactions: `db.transaction((tx) => { ... })`. better-sqlite3 transactions are **synchronous** — don't `await` inside them.
- Pragmas (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`) are set in `client.ts`. Don't override per-call.

## Tests

- Use `setupTestDb()` from `../trpc/test-helpers` — fresh SQLite + temp `ENGY_DIR` + migrations per test. **No mocks** for the DB.
- `schema.ts`, `migrate.ts`, and `migrations/` are excluded from coverage thresholds (90/85/90/90 apply elsewhere in `src/server/**`).
