# Full sweep personas

Use one tester per persona. Run them in this order, so that later testers have content. After the run, give a new tester any area that a persona could not reach, and list what is already known.

## newuser: first-time user

Scope: onboarding and navigation. Home page, creating a workspace from the UI with bad inputs (empty name, duplicate name, missing repo path), workspace settings, first project, empty states on every page, navigation and breadcrumbs, `/open` and `/inbox`, the workspace pages (tasks, docs, specs, memory, usage), how a new user learns to run an agent, help text, loading states, and 404 pages for a bad workspace slug and a bad project slug.

## planner: tech lead who plans work

Scope: task planning. Through the UI only, create a project, about 10 realistic tasks (AI and human, with different importance and urgency), task groups, a milestone and `blockedBy` dependencies. Then use list and kanban views, filters, sorting, search, edit (title, markdown description, status, group and milestone), drag and drop, bulk actions, delete and undo, the task dialog, keyboard shortcuts, copy link and slug, workspace tasks against project tasks, and the project overview. Try empty and very long titles, and circular dependencies. List the task titles that you create at the end of the report.

## runner: developer who runs agents

Scope: running agents and reviewing their output. Through the UI, create a project with 2 or 3 tiny AI tasks on the sample repo, such as "Add a subtract(a, b) function with a test". Start them the way a user would find out how. Check how easy it is to start an agent, status while it runs, the terminal (open, scroll, type, resize, split, close, reconnect after a reload), the end of a run, task status changes, inbox and notifications, the diffs page, comments on diff lines, the code page, the PRs page, the usage page, stopping an agent, running two at once, and errors such as no git remote. Give each agent at most 10 minutes. If one hangs, report it and go on.

## docs: engineer who writes specs and docs

Scope: specs, docs, memory and plans. Workspace and project docs, specs, creating and editing docs (headings, lists, code blocks, links, tables, a long document, save feedback, unsaved changes), comments and review threads (add, reply, resolve, reopen, delete, send to an agent), rename, delete, move, folders, the same file in two tabs, rich rendering (tables, mermaid, images, task lists), memory pages (create, view, filter, promote, dismiss), Claude Plans, and knowledge search.

This scope is large. Expect to need a second pass with the areas that the first tester did not reach.

## dx: developer who sets up and integrates Engy

Scope: developer experience outside the browser pages. Follow the README from a fresh worktree: install, `pnpm dev`, first workspace, daemon connection. Use the MCP tools as an agent would: `listTasks`, `createTask` and `updateTask` with bad inputs, and read each error as a person who cannot see the code. Run one skill from `plugins/engy/skills`. Check the setup steps, the error text, the defaults, the time to first success, and whether docs match what you see. Record each command, its output, and each place where you had to guess.

## mobile: phone and keyboard user

Scope: responsive layout, accessibility and polish. Start this tester last. Use `resize 390 844` (phone), `resize 820 1180` (tablet) and `resize 1440 900` (desktop). At phone width, visit every surface: home, inbox, open, each workspace page, each project page, task dialogs, the terminal panel and settings. Look for horizontal overflow, clipped text, buttons out of reach, small tap targets, menus that do not open, and dialogs that do not fit. At desktop width, do a keyboard-only pass: visible focus, tab order, Escape, Enter, focus after a dialog closes, icon buttons with no accessible name, contrast in each theme, and the page title on each route.
