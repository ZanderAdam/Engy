# Combined Worktrees — design note

## Goal
Combine all of a project's worktrees into a single project view (default), instead of
siloing one worktree per browser tab. A workspace-level **Split worktrees** toggle restores
the old per-`?wt=` silo behaviour.

## Decisions (locked with user)
- **Combined is default.** `splitWorktrees=false`.
- In combined mode, non-terminal content (docs/tasks/files) always reads the **default branch**.
  Worktrees become a **terminal-only** dimension.
- **Combined is only allowed when docs are NOT inside a repo** (standard engy dir or an
  external custom docsDir). When `docsDir` sits inside a repo, content is itself
  worktree-dependent (`effectiveDocsDirForBranch`), so we force split mode regardless of the flag.
- Grouping by worktree applies to **all terminal surfaces**: right rail, dock dropdowns, bottom shell.
- Keep the existing create/manage-worktrees dialog.

## Mechanism
Terminals are grouped into a `TerminalManager` by `scope.groupKey`.
- **Split (today):** `project:<ws>:<proj>:wt:<branch>` — one manager per worktree, content rebased via `?wt=`.
- **Combined (new):** `project:<ws>:<proj>` — ONE manager holds terminals for *all* worktrees.
  Each terminal carries `scope.worktreeBranch` (undefined = default branch). The rail and the
  "all terminals" dropdown group by `worktreeBranch`. The new-terminal menu lists, per worktree,
  one entry per repo (+ "All Repos").

`worktreeBranch` is persisted through the WS spawn params → `TerminalSessionMeta` →
`/api/terminal/sessions`, so grouping survives reloads.

## Touch points
- Schema: `workspaces.split_worktrees` boolean (default false) + migration.
- `workspace.get`: returns raw `splitWorktrees` + derived `combinedWorktrees`.
- `TerminalScope.worktreeBranch`; buildWsUrl; terminal-server meta; server.ts sessions GET; sessionToTab.
- `useTerminalScope`: combined → ignore `?wt`, project-level groupKey.
- WorkspaceLayout: combined → per-worktree dropdown groups from `worktree.listGrouped`.
- TerminalRail + TerminalDockActions: group by `worktreeBranch`.
- ProjectLayout: combined → hide content `WorktreeDropdown`, keep a manage-worktrees button.
- Edit workspace dialog: Split-worktrees toggle (disabled/forced when docs inside repo).

## Known limitation
Agent worktree sessions surfaced via `execution.getWorktreeSessions` keep their own
`worktree:<ws>` groupKey (separate silo) — not folded into the project combined manager.
