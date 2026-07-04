---
name: update-readme-screenshots
description: This skill should be used when the user asks to "update the README screenshots", "refresh the README", "regenerate the screenshots", "take new screenshots for the README", or "update the readme with new screenshots". Drives the Engy dev app with playwright-cli against seeded dev data to (re)capture the feature screenshots in docs/screenshots/ and rewrite the README, without committing.
---

# Update README Screenshots

Refresh the Engy `README.md` and the feature screenshots in `docs/screenshots/` to match the current UI. The flow: seed realistic data into the throwaway dev DB, run `pnpm dev`, drive the app with `playwright-cli`, capture one screenshot per feature, crop where needed, rewrite the README prose, and clean up. **Never commit** unless explicitly told to.

## Non-negotiable safety rules

- **Never touch prod `~/.engy`.** Only run the dev server (uses `ENGY_DIR=.dev-engy`). After the server is up, verify it: `workspace.list` must return ONLY the `engy` workspace, not the full prod set (milosadventure, spacecorsair, …). If it shows everything, it is pointed at prod — stop.
- **All seeding stays in `web/.dev-engy/` (gitignored).** Memory-row copies and task renames are DB-only and never produce commits.
- **Do not commit.** The deliverable is the working-tree change to `README.md` + `docs/screenshots/*`.
- **Flag, don't touch, foreign changes.** The shared working tree often has concurrent uncommitted edits from other sessions (e.g. `web/src/...`, `client/src/...`). Leave them; mention them in the wrap-up.
- **localhost is blocked in the command sandbox.** Every `curl localhost:*` and every `playwright-cli` call needs `dangerouslyDisableSandbox: true` (the session file write and the network both fail otherwise).

## Step 1 — Seed realistic dev data

The `engy` workspace stores its docs/plans/memory inside the repo (`docs/`), but the DB rows (tasks, memories) live in `web/.dev-engy/engy.db`. A fresh dev DB usually has the project but **0 memories** and test-junk task names.

Run the seed script (copies memory rows prod→dev; the on-disk `docs/memory/*` files already match):

```bash
scripts/seed-dev-memories.sh   # from the skill dir; copies permanent+fleeting memory rows for workspace 1
```

Then make the Kanban presentable by hand (see `references/dev-environment.md` → "Seeding tasks"): rename test tasks to realistic names, and to surface "done" cards set `milestone_ref=NULL` and bump `updated_at` (the board filters out milestone-tagged and stale-done tasks).

## Step 2 — Run / find the dev server

```bash
nohup pnpm dev > /tmp/claude/engy-dev.log 2>&1 &
# wait for: [dev] web + client running on http://localhost:<port>
grep -E '\[dev\]|Ready on' /tmp/claude/engy-dev.log
```

Read the port from the `[dev]` log line (it auto-picks a free one). If a healthy dev server is already running for this repo, reuse it. Confirm health and data source with two sandbox-off curls (see safety rules). The dev server is **fragile** — if it returns `HTTP 000` or screenshots show `ERR_CONNECTION_REFUSED`, see `references/dev-environment.md` → "Turbopack OOM / crash recovery".

## Step 3 — Drive the browser

- Always use a named session: `playwright-cli -s=readme <cmd>` (the default session collides with other Claude sessions).
- Set a wide window once: `playwright-cli -s=readme resize 1792 1120`. Screenshots come out 1792-wide — plenty for GitHub.
- **Navigate between tabs by clicking the in-app nav links, not `goto`.** `goto` reloads and re-expands the terminal panel and resets UI state; in-app clicks preserve the collapsed-terminal state.
- After each `screenshot`, **Read the PNG** to verify content before saving it — the app frequently shows empty/`Loading…`/`Select a file` states that look fine to the tool but are blank.
- URL shape: `http://localhost:<port>/w/engy/projects/initial/<tab>` where tab ∈ `''|docs|tasks|claude-plans|diffs|code|memory`.

## Step 4 — Capture each screenshot

The current README set lives in `docs/screenshots/`. Capture/refresh each, then save with `cp` over the target name:

| File | Tab / view | Notes |
|---|---|---|
| `project-overview.png` | Overview | toggle "Show done", expand a milestone; terminal rail showing Claude Code |
| `task-kanban.png` | Tasks (Kanban) | balanced Todo/In Progress/Review/Done columns |
| `docs-editor.png` | Docs → open `spec.md` | must show rendered content, not the empty state |
| `docs-comments.png` | Docs → comment thread | drag-select text → "Add comment" |
| `mermaid-visual-editor.png` | Docs → mermaid block → pencil | the visual flowchart editor dialog |
| `diffs-review.png` | Diffs → file diff → line comment | inline comment on a gutter-clicked line |
| `code-editor.png` | Code → "Go to File" a `.ts` | Monaco with minimap |
| `memory-browser.png` | Memory → open a `decision` memory | detail view with tags/themes/keywords |
| `claude-plans.png` | Claude Plans → open a plan | engy plan (see recipe — reads from `~/.claude/plans/`) |
| `terminal.png` | terminal rail + session list | crop of the right rail |

The exact, fiddly interaction recipe for **each** of these (which buttons, the Monaco gutter-comment trick, the BlockNote comment flow, the mermaid pencil, the Claude-Plans temp-file trick, collapsing the terminal panel, the bottom-dock localStorage flag) is in **`references/ui-capture-recipes.md`** — consult it per screenshot rather than rediscovering.

## Step 5 — Crop when needed

`sips` only center-crops. For an offset crop (e.g. the terminal rail), use the PIL helper:

```bash
python3 scripts/crop-region.py <src.png> <left> <top> <right> <bottom> <dest.png>   # right/bottom 0 = full
```

## Step 6 — Rewrite the README

Update `README.md` prose to match current features (consult `docs/system/features/*.md` for accurate, current descriptions of each area). Use clean, descriptive image filenames and keep one `![alt](docs/screenshots/x.png)` per feature section. After editing, verify every reference resolves:

```bash
grep -oE 'docs/screenshots/[a-z-]+\.png' README.md | sort -u | while read p; do [ -f "$p" ] && echo "OK $p" || echo "MISSING $p"; done
```

Delete screenshots no longer referenced.

## Step 7 — Clean up

- Delete any temp props created for a shot (e.g. a scratch `architecture.md` for the mermaid demo, a temp plan dropped into `~/.claude/plans/`).
- Re-confirm `git status` shows only `README.md` + `docs/screenshots/*` as your changes; everything else is foreign — report it, don't touch it.
- Do not commit.

## Additional resources

- **`references/ui-capture-recipes.md`** — per-screenshot interaction recipes and the UI gotchas (Monaco gutter comments, BlockNote comments, mermaid visual editor, Claude Plans source dir, terminal panel/dock controls, file-tree clicking).
- **`references/dev-environment.md`** — seeding the dev DB (memories + tasks), Turbopack OOM/lock/relay recovery, sandbox+curl, port discovery, verifying `.dev-engy` ≠ prod.
- **`scripts/seed-dev-memories.sh`** — copy memory rows prod→dev.
- **`scripts/crop-region.py`** — offset image crop via PIL.
