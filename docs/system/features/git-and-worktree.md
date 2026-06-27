---
description: Git status, log, diff, and commit inspection on user repos, plus worktree lifecycle management across multi-repo workspaces.
order: 9
---

# Git & Worktree

Engy surfaces git operations on user-owned repositories through the daemon
bridge. The server never calls git directly — every operation dispatches over
the `/ws` control channel to the local client daemon, which runs git in the
user's filesystem. This keeps the server safe to host remotely while repos stay
local.

Two tRPC routers handle this area:

- `web/src/server/trpc/routers/diff.ts` — read-only git introspection
  (`getStatus`, `getLog`, `getCommitDiff`, `getBranchDiff`) and the
  `getWorktrees` query for listing git worktrees by repo.
- `web/src/server/trpc/routers/worktree.ts` — worktree lifecycle mutations
  (`listGrouped`, `create`, `sync`, `remove`).

The client-side implementation lives in `client/src/git/index.ts`, which
executes `git` via `execFile` and parses `--porcelain` output directly. All
dispatcher functions in `web/src/server/ws/server.ts`
(`dispatchGitStatus`, `dispatchGitLog`, `dispatchGitShow`,
`dispatchGitBranchFiles`, `dispatchGitWorktreeList`) follow the pending-map
request/response pattern with a 15-second timeout (`GIT_TIMEOUT_MS = 15_000`).
`dispatchWorktreeAdd` and `dispatchWorktreeRemove` use a 60-second timeout
(`WORKTREE_MERGE_TIMEOUT_MS = 60_000`) to accommodate branch creation and merge
operations that take longer than a plain read.

## Effective directory selection

Every read procedure (`getStatus`, `getLog`, `getCommitDiff`, `getBranchDiff`)
accepts an optional `worktreePath` alongside `repoDir`. When `worktreePath` is
supplied it is used as the effective directory dispatched to the daemon,
allowing the same tRPC call to target either the main checkout or any linked
worktree.

## Commit diff strategy

`getShow` in the client (`client/src/git/index.ts`) uses `git diff-tree -r -M
--name-status`. It probes for a first parent (`rev-parse --verify --quiet
<hash>^1`) before constructing the ref arguments: root commits use `--root
<hash>`; ordinary commits use `<hash>^1 <hash>`. Merge commits diff against
their first parent only, matching GitHub's behaviour.

## Porcelain status parsing

`parsePorcelainStatus` in `client/src/git/index.ts` tokenises the NUL-separated
output of `git status --porcelain=v1 -b -z`. The branch header covers three
cases: normal (`## <branch>...`), detached HEAD (`## HEAD (no branch)` →
`branch='HEAD'`), and brand-new repos with no commits (`## No commits yet on
<branch>` → real branch name). Rename entries (`R`/`C` XY code) consume two
NUL tokens; the second (original-path) token is discarded. `getStatusDetailed`
wraps the parser and maps each entry's `XY` code pair to a typed `GitFileStatus`
+ `staged` boolean via `mapStatusCode`.

## Worktree lifecycle

`worktree.create` (`web/src/server/trpc/routers/worktree.ts`) serialises branch
creation: repo[0] runs first with `createBranch: true` so the branch exists
before any other repo checks it out. Remaining repos then run in parallel with
`createBranch: false`. On any failure in the parallel step, all repos that
already succeeded are rolled back via `WORKTREE_REMOVE_REQUEST force: true`;
orphaned paths (rollback also failed) are named in the error message.
`worktree.sync` is the additive twin — it materialises an existing branch in
selected repos in parallel, returns per-repo results, and never rolls back.
`worktree.remove` returns a per-repo result list; a repo with uncommitted changes
fails with code `DIRTY` unless `force: true` is passed through.

All lifecycle mutations validate that every supplied repo path is a member of
`workspace.repos`, and that the branch name matches `[A-Za-z0-9._/-]+`.

## Multi-repo grouping

`worktree.listGrouped` queries all repos in `workspace.repos` in parallel using
`Promise.allSettled`, groups non-main worktrees by branch name, and returns
sorted groups alongside a per-repo `errors` list for any repo whose enumeration
failed — partial success is the contract, not all-or-nothing.

## File glob for test discovery

`globTestFiles` in `client/src/git/index.ts` uses `git ls-files --cached
--others --exclude-standard` as its primary path, returning absolute paths for
both tracked and untracked (non-ignored) files whose names match the supplied
pattern suffixes. For non-git directories it falls back to recursive `readdir`
up to depth 10, skipping `.git`, `node_modules`, `dist`, `build`, `.next`,
`__pycache__`, and dot-prefixed directories.

## Requirements

Functional requirements in EARS notation. These are the single source of truth
for the git-and-worktree feature's behaviour. Tag the verifying tests with the
FR id in their title string, e.g. `it('[FR-GIT-010] ...', ...)`, and run
`trace` (or `engy:validate`) to check coverage.

| ID | Requirement (EARS) |
|----|--------------------|
| FR-GIT-010 | WHEN `worktreePath` is supplied alongside `repoDir`, the system SHALL use `worktreePath` as the effective directory dispatched to the daemon for all git read operations. |
| FR-GIT-020 | IF no daemon is connected, THEN the system SHALL reject any git read or worktree dispatch with an error containing "No daemon connected". |
| FR-GIT-030 | WHEN `getLog` is called with a `maxCount` value between 1 and 200 inclusive, the system SHALL pass that value to the daemon and return at most that many commits. |
| FR-GIT-040 | WHEN `getShow` is called for a root commit (no first parent), the system SHALL diff using `--root <hash>`; for all other commits it SHALL diff `<hash>^1` against `<hash>`, diffing merge commits against their first parent only. |
| FR-GIT-050 | WHEN a file was renamed in a commit, the system SHALL include `oldPath` in that file's result entry from `getShow`. |
| FR-GIT-060 | IF `getBranchDiff` receives a base ref that the daemon cannot resolve, THEN the system SHALL throw a `BAD_REQUEST` TRPCError whose message quotes the unresolvable ref. |
| FR-GIT-070 | WHEN `getStatusDetailed` is called on a repo in detached HEAD state, the system SHALL return `branch: 'HEAD'`; on a repo with no commits yet it SHALL return the real branch name, not a parser artefact. |
| FR-GIT-080 | WHEN `getStatusDetailed` is called, the system SHALL return `staged: true` for index-only changes and `staged: false` for working-directory-only changes. |
| FR-GIT-090 | WHEN `worktree.listGrouped` is called, the system SHALL query all `workspace.repos` in parallel, exclude main worktrees, group remaining worktrees by branch name, and return the groups sorted alphabetically by branch. |
| FR-GIT-100 | WHEN one or more repos fail during `worktree.listGrouped`, the system SHALL record those repos in the `errors` list and still return the groups from all successful repos. |
| FR-GIT-110 | WHEN `worktree.create` is called with multiple repos, the system SHALL run `WORKTREE_ADD_REQUEST` with `createBranch: true` on the first repo alone before running all remaining repos in parallel with `createBranch: false`. |
| FR-GIT-120 | IF any repo after the first fails during `worktree.create`, the system SHALL roll back all already-succeeded repos via `WORKTREE_REMOVE_REQUEST` with `force: true` and include any leaked (un-rollable) worktree paths in the error message. |
| FR-GIT-130 | WHEN `worktree.create`, `worktree.sync`, or `worktree.remove` is called, the system SHALL reject any repo path not present in `workspace.repos` with a `BAD_REQUEST` error, and SHALL reject any branch name not matching `[A-Za-z0-9._/-]+`. |
| FR-GIT-140 | WHEN `worktree.sync` is called, the system SHALL dispatch `WORKTREE_ADD_REQUEST` with `createBranch: false` for each repo in parallel, return a per-repo success/error list, and never trigger rollback on individual repo failures. |
| FR-GIT-150 | WHEN `worktree.remove` is called without `force`, the system SHALL return `success: false` with `code: 'DIRTY'` for any repo that has uncommitted changes; WHEN called with `force: true`, the system SHALL pass `force: true` to the daemon to bypass the dirty guard. |
| FR-GIT-160 | WHEN `globTestFiles` is called on a git repository, the system SHALL use `git ls-files --cached --others --exclude-standard` to enumerate matching files, returning absolute paths for both tracked and untracked non-ignored files. |
| FR-GIT-170 | WHEN `globTestFiles` is called on a non-git directory, the system SHALL fall back to recursive `readdir` up to depth 10, skipping `.git`, `node_modules`, `dist`, `build`, `.next`, `__pycache__`, and dot-prefixed directories. |

## Sources

No prior knowledge found.
