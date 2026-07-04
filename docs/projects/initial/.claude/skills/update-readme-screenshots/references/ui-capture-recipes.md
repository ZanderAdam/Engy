# UI Capture Recipes

Per-screenshot interaction recipes for `playwright-cli -s=readme`. All commands need `dangerouslyDisableSandbox: true`. After every `screenshot`, Read the PNG to verify it isn't a blank/`Loading…`/`Select a file` state.

## General driving notes

- **Clicking by coordinates:** `playwright-cli -s=readme mousemove X Y` then `mousedown` then `mouseup`. Use this for elements that resist eval-clicks (tree rows, diagram toolbar icons, Monaco gutter).
- **Clicking by element:** prefer dispatching the full sequence so React handlers fire:
  ```js
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t,{bubbles:true})))
  ```
- **Locate an element's coords:** `eval "() => { const el = ...; const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; }"`. When several nodes match a text, take the **last** match (`els[els.length-1]`) — it's usually the leaf.
- **Collapse the terminal panel** for clean full-width content shots: click the button with `aria-label === 'Collapse terminal panel'`. Re-expand with `'Show terminal panel'`.
- **Bottom terminal dock** (the "No terminals open" strip at the bottom) is controlled by `localStorage['engy-bottom-terminal-expanded']`. Set it to `'false'` and reload to remove it.

## project-overview.png (Overview)

1. Navigate to the project → Overview.
2. Toggle "Show done": click `document.querySelector('[role=switch]')` so completed milestones appear.
3. Expand a milestone with task groups (e.g. a completed one with `N/N`): find a `div` whose text includes the milestone name and dispatch a click on it (the chevron). Tasks like `T-31 …` should appear.
4. Keep the terminal rail visible showing Claude Code (see terminal.png recipe to launch it first).
5. `eval "() => window.scrollTo(0,0)"`, screenshot.

## task-kanban.png (Tasks)

1. Tasks tab. The board reads from the DB; make it presentable first (see `dev-environment.md` → "Seeding tasks"): ~2 Todo, ~2 In Progress, 1 Review, several Done.
2. The Done column hides milestone-tagged and stale-done tasks — surface cards by setting `milestone_ref=NULL` and bumping `updated_at` in the DB.
3. If a "Filter N" badge hides columns, open it and click "All" for the done limit. Reload after DB edits.

## docs-editor.png (Docs)

1. Docs tab. Open `spec.md`: find the leaf element whose text is exactly `spec.md` and dispatch the full mouse sequence on it. **Verify** the SRS content rendered (not "Select a file to view").
2. If a Comments panel is open from a prior step, close it (its `×` is near "Copy All" at the panel header top-right ~`x≈1700,y≈231`) for a clean full-width doc.

## docs-comments.png (Docs comment thread)

1. With `spec.md` open, drag-select a phrase: `mousemove`→`mousedown`→`mousemove`(end)→`mouseup` across one line of a paragraph.
2. A floating toolbar appears with an **"Add comment"** button (`aria-label === 'Add comment'`). Click it.
3. Type the comment, then click **Save**.
4. The thread appears in a right-hand Comments panel with a send-to-terminal action; the anchored text is highlighted. Click into the panel to dismiss the selection toolbar, then screenshot.
5. Comments persist in the DB (survive reloads). Optionally delete afterward via the comment tables (`comment_threads`, `thread_comments`, `comments`).

## mermaid-visual-editor.png (Docs → mermaid)

1. Needs a doc containing a ` ```mermaid ` **flowchart** block. If none exists, create a scratch one and delete it after:
   ```
   docs/projects/initial/architecture.md  with a  ```mermaid\nflowchart TD\n  A[..] --> B[..]\n```  block
   ```
   Then in Docs, click the file's refresh button (`aria-label` ~ /refresh/) and open it.
2. The diagram renders inline with a toolbar (pencil, −, %, +, fullscreen) at its top-right. Click the **pencil** (leftmost icon, ~`x≈1513` of the diagram toolbar) — NOT the `−` next to it.
3. The visual editor dialog opens: source on the left, interactive flowchart + node-shape palette on the right. Screenshot, then close (`×` top-right) and delete the scratch doc.

## code-editor.png (Code → Monaco)

1. Code tab. Collapse the terminal for full width.
2. Click **"Go to File"** (button text matches /Go to File/), type a source file name (e.g. `watcher.ts`), and **click the result row** (Enter often doesn't register on the overlay).
3. Verify Monaco rendered with syntax highlighting + minimap + the `TYPESCRIPT` status bar.

## diffs-review.png (Diffs → line comment)

1. Diffs tab. Use the "Filter files…" input to type `spec` (or any modified file), expand the folder by clicking its chevron, and click the file to load its diff. If it shows "Failed to load file content", the daemon hiccuped — retry the click.
2. The diff viewer is **Monaco**. To add a line comment, **click the line-number gutter** of a changed line (`mousemove`/`mousedown`/`mouseup` at the modified-side line number, ~`x≈452`). An inline comment input appears.
3. **The Monaco overlay textarea will not accept `playwright-cli type`.** Set its value via React's native setter, then dispatch `input`:
   ```js
   const ta = document.querySelector('textarea');
   const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
   setter.call(ta, 'your comment'); ta.dispatchEvent(new Event('input',{bubbles:true}));
   ```
4. Click **"Comment"** (now enabled). The thread anchors to the line with Resolve/Delete and "Send Feedback (N)" appears in the header. Screenshot.

## claude-plans.png (Claude Plans)

- The Claude Plans tab reads plan markdown from **`~/.claude/plans/`** (the daemon home), NOT the repo's `docs/projects/initial/plans/`. A fresh env may only have unrelated plans (random slug names like `frolicking-foraging-clarke.md`).
- To feature a real engy plan: copy one from the repo into the plans dir temporarily, screenshot, then delete it:
  ```bash
  cp docs/projects/initial/plans/engy-T215.plan.md ~/.claude/plans/add-task-bar-to-terminal-tabs.md
  ```
  In the tab, click the file's refresh button, then click the new plan in the PLANS list. Collapse the terminal for full width. Delete the temp file when done.

## memory-browser.png (Memory)

1. Memory tab. Pick a **`decision`** or **`pattern`** memory (richer than a gotcha "insight") — it shows the "why" plus TAGS / THEMES / KEYWORDS / LINKED MEMORIES.
2. Click the card (full mouse sequence). The detail route can be slow to compile on first load — poll until the body contains the memory's content rather than `Loading…`.
3. Screenshot the list + detail together.

## terminal.png (terminal rail + session list)

1. Show the terminal panel (`aria-label 'Show terminal panel'`).
2. Launch Claude Code: in the empty panel use **"CLAUDE IN REPOS → engy"** (clicking the repo entry runs `claude` with the Engy system prompt). It shows a real session in `~/dev/engy`. If a folder-trust prompt appears, press Enter.
3. Expand the session list with `aria-label 'Expand terminal list'` so the sidebar of sessions shows alongside the active terminal.
4. Crop the right region (sidebar + terminal) with `scripts/crop-region.py`, e.g. box `1068 44 0 1113` (right=0 → full width).

**Caveat:** spawning *multiple* fresh shells via "New terminal" is unreliable when the daemon↔web terminal-relay WebSocket is flaky (common after dev-server crashes — symptom: `WebSocket is closed before the connection is established`). If only one session will attach, capture the sidebar + single Claude session and note the limitation.
