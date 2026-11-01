# Dev Environment for Screenshots

Everything about getting a stable, well-seeded dev instance. All `curl localhost` / `pnpm exec playwright-cli` / process commands need `dangerouslyDisableSandbox: true`.

## Port discovery & health

`pnpm dev` picks a free port and logs `[dev] web + client running on http://localhost:<port>`. Read it from the log:

```bash
grep -oE 'localhost:[0-9]+' /tmp/claude/engy-dev.log | head -1
```

Health + data-source check (must show ONLY the `engy` workspace — proves `ENGY_DIR=.dev-engy`, not prod):

```bash
curl -s "http://localhost:<port>/api/trpc/workspace.list?input=%7B%7D" \
  | python3 -c "import sys,json;print([(w['id'],w['slug']) for w in json.load(sys.stdin)['result']['data']['json']])"
```

Confirm the process env if unsure: `ps eww <pid> | tr ' ' '\n' | grep -E 'ENGY_DIR|^PORT='` → expect `ENGY_DIR=.dev-engy/`. The ambient `PORT` can override `.dev.env` (dotenv no-override), so the log may say "preferred 3000 was busy" while `ENGY_DIR` is still correct — verify the workspace list, not the port.

`HTTP 000` from curl = server down or thrashing. Browser `ERR_CONNECTION_REFUSED` screenshot = same.

## Turbopack OOM / crash recovery

The Next 16 + Turbopack dev server crashes under memory pressure with either:
- corruption: `Failed to restore task data (corrupted database or bug) … Unable to open static sorted file NNN.sst`, or
- `exited (137)` SIGKILL (OOM killer).

This is a known bug (it's literally one of the workspace memory notes). Recovery sequence:

```bash
# 1. kill the main-repo dev tree (NOT prod :3000, NOT other worktrees under .claude/worktrees/)
pgrep -fl node | grep -E '/dev/engy/(node_modules/.bin/../turbo|web|client)' \
  | grep -v worktrees | grep -vE 'prod|grep' | awk '{print $1}' | xargs -r kill -9

# 2. clear the (possibly corrupted) dev cache AND the stale lock
rm -rf web/.next/dev          # or just web/.next/dev/cache
rm -f  web/.next/dev/lock     # "Unable to acquire lock … is another instance running?" after a crash

# 3. restart
nohup pnpm dev > /tmp/claude/engy-dev.log 2>&1 &
```

Notes:
- A **cold** rebuild (after `rm -rf web/.next/dev`) spikes memory and may OOM again under pressure. If it dies on the first compile, free memory (close other dev servers if they are yours) and retry; once one compile completes, the warm cache makes restarts cheaper.
- After a crash, `tsx watch` may auto-restart the web server but leave the `.next/dev/lock`, blocking it — remove the lock.
- The machine often runs prod (`:3000`), a worktree dev (`:4000`), and this dev simultaneously. That triple load is what triggers the OOM. The worktree/prod servers are the user's — do not kill them without asking.
- **Warm up gently** after restart: one `curl` to the project page with a long `--max-time` to let the route compile, then navigate. Hammering parallel requests triggers parallel compiles → OOM.

## Seeding memories

The `engy` workspace's permanent-memory markdown files already exist on disk under `docs/memory/**` (untracked), but a fresh dev DB has 0 rows. `scripts/seed-dev-memories.sh` copies the rows from prod `~/.engy/engy.db` into `web/.dev-engy/engy.db` via `ATTACH` (same `workspace_id`, same `file_path` pointing at the on-disk files). Columns match between prod and dev. This is a read of prod + write to dev only — it never runs the server against prod and never writes files or commits.

Verify after seeding:
```bash
sqlite3 web/.dev-engy/engy.db "select 'perm',count(*) from permanent_memories union all select 'fleeting',count(*) from fleeting_memories;"
```

## Seeding tasks

Tasks are DB-only (no files, no commits). A fresh dev `initial` project has real done tasks (e.g. the M5 diff-viewer tasks) plus test-junk (`test task`, `say hello`). To make a clean Kanban, rename the junk and place cards across statuses:

```sql
-- rename junk → realistic, spread across statuses
UPDATE tasks SET title='Add command-palette keyboard shortcuts', status='todo',        type='ai'    WHERE id=<x>;
UPDATE tasks SET title='Persist terminal tab layout across reloads', status='in_progress', type='ai' WHERE id=<y>;
UPDATE tasks SET title='Add repo picker to the agent prompt', status='review',          type='human' WHERE id=<z>;
```

The Kanban hides tasks that (a) belong to a milestone the board isn't scoped to, and (b) are "done" but stale. To make done cards appear:

```sql
UPDATE tasks SET milestone_ref=NULL WHERE id IN (...);                  -- match the board's no-milestone view
UPDATE tasks SET updated_at='<now ISO>' WHERE id IN (...) AND status='done';  -- pass the recency filter
```

Find ids first: `sqlite3 web/.dev-engy/engy.db "select id,substr(title,1,40),status,milestone_ref,task_group_id from tasks where project_id=2 order by status;"`. Reload the page after DB edits (the UI queries per request, but an open page won't refetch).

## Process map (typical)

```
:3000  prod (engy-worktrees/prod, PM2)          — LEAVE ALONE
:4000  worktree dev (.claude/worktrees/...)      — LEAVE ALONE (user's)
:<rand> main-repo dev (this skill's server)      — yours to manage
```

Identify each with `lsof -nP -iTCP -sTCP:LISTEN | grep node` and the process command path.

## Tooling availability

- `PIL` (Pillow) is available for Python image work; `ImageMagick`/`magick`/`convert` and `sips` are **not**. Use `scripts/crop-region.py` for crops.
- `pnpm exec playwright-cli` writes browser state under `~/.cache/ms-playwright/` and per-session snapshots into `.playwright-cli/` — the cache write is blocked by the sandbox, hence `dangerouslyDisableSandbox` on every call.
