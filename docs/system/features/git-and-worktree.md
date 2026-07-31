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
  (`getStatus`, `getLog`, `getCommitDiff`, `getBranchDiff`, `getDefaultBase`)
  and the `getWorktrees` query for listing git worktrees by repo.
- `web/src/server/trpc/routers/worktree.ts` — worktree lifecycle mutations
  (`listGrouped`, `create`, `sync`, `remove`).

The client-side implementation lives in `client/src/git/index.ts`, which
executes `git` via `execFile` and parses `--porcelain` output directly. All
dispatcher functions in `web/src/server/ws/server.ts`
(`dispatchGitStatus`, `dispatchGitLog`, `dispatchGitShow`,
`dispatchGitBranchFiles`, `dispatchGitDefaultBase`, `dispatchGitWorktreeList`)
follow the pending-map
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

## Branch diff strategy

`getBranchFiles` diffs against the **merge base** of the supplied base ref and
`HEAD`, not the base ref itself. A plain `git diff <base>` compares the base
branch's current tip to the working tree, so every commit the base gained after
the branch forked is reported as an inverted change — a fully merged branch can
show hundreds of phantom deletions. Resolving `git merge-base <base> HEAD` first
restricts the result to what the branch itself changed, while still including
uncommitted work (which the three-dot `<base>...HEAD` form would drop).

`git merge-base` fails in two distinct cases and both fall back to the raw base
ref. A ref that does not resolve makes the subsequent `git diff` throw, which
surfaces as a bad-ref error. A ref that resolves but shares no ancestor with
`HEAD` (unrelated histories) degrades to a plain base-tip diff — there is no
fork point to diff from, so that is the only computable answer, and the result
may include base-side changes as inverted entries.

The resolved merge base is returned alongside the file list so callers can read
"before" file contents at the same commit the list was computed from — the diff
viewer and the file list would otherwise disagree once the base advanced.
`-M` is passed for parity with `getShow`, so branch diffs report renames rather
than add/delete pairs.

`git diff` only reports tracked paths, so a second pass adds untracked files via
`git ls-files --others --exclude-standard --full-name -z`, marked `added`. This
matches `Latest Changes` (which lists them through porcelain status) and keeps
brand-new files visible in a branch review. `--exclude-standard` applies the
repository's ignore rules, so build output and dependency directories stay out;
`--full-name` yields repo-root-relative paths matching the diff output. The two
lists overlap after `git rm --cached`, which un-tracks a file but leaves it on
disk: the diff calls it deleted while `ls-files --others` calls it untracked. The
diff's entry wins, since losing tracking is the change relative to the base.

## File content identity

`getStatusDetailed` and `getBranchFiles` attach a `contentId` to every listed
path that exists on disk: an opaque `size:mtimeMs` string from `lstat`. This
exists so the diff UI can expire a per-file "viewed" mark when the file changes
again — the mark is recorded against the id, not just the path.

`git hash-object` was rejected for this. It dereferences symlinks, so a link's
id would track its target's content rather than the link itself; it aborts an
entire batch on directories and submodule gitlinks; and it costs a process spawn
per listing. `lstat` describes the path itself, covers every entry type, and
needs no subprocess.

Paths with no id are those with nothing to identify: deleted files, the `dir/`
entry porcelain emits for an untracked directory, and submodule gitlinks (both
report as directories). A file touched without its bytes changing gets a new id
and loses its viewed mark — deliberately the safe direction, since re-reviewing
an unchanged file costs a click whereas a mark that fails to expire hides real
changes.

Known gap: `getBranchFiles` parses `git diff --name-status` without `-z`, so a
path containing a tab or newline (or any non-ASCII path under the default
`core.quotePath`) arrives C-quoted and will not match a file on disk. Such a
path is displayed quoted and carries no `contentId`, so its viewed mark cannot
expire. `getStatusDetailed` uses `-z` and is unaffected.

## Default base detection

`resolveDefaultBase` determines a repo's default branch without network access,
in order: the recorded `refs/remotes/origin/HEAD` symbolic ref; then probing
`origin/main`, `origin/master`, `origin/develop`, `main`, `master`; then the
current branch. The probe step matters because git only writes `origin/HEAD` at
clone time, so repos created with `git init` or migrated between remotes never
have it. `git remote show origin` is deliberately not used — it requires network
round-trips and credentials.

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
fails with code `DIRTY` unless `force: true` is passed through. It resolves each
target by enumerating `git worktree list` and matching the branch — operating on
the worktree's *actual* path rather than recomputing a canonical one — so it can
remove any worktree `listGrouped` surfaces, including externally-created trees
that do not live at the path `getProjectWorktreeDir` would produce. This costs one
extra `GIT_WORKTREE_LIST_REQUEST` per repo per `remove` invocation — including the
follow-up forced re-call, which re-resolves the path. A forced remove targets the
"worktree is gone" end state, so an already-absent worktree resolves to success.

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
| FR-GIT-180 | WHEN `worktree.remove` is called, the system SHALL resolve each repo's target by matching the branch against `git worktree list` and dispatch `WORKTREE_REMOVE_REQUEST` with that worktree's actual path; IF no non-main worktree matches the branch, the system SHALL return `success: false` with `code: 'OTHER'` without dispatching a remove WHEN `force` is false, and `success: true` WHEN `force` is true (the worktree is already gone). |
| FR-GIT-190 | WHEN `resolveDefaultBase` is called, the system SHALL return the branch named by `refs/remotes/origin/HEAD` if that symbolic ref is set AND still resolves to a commit; OTHERWISE it SHALL return the first resolvable ref among `origin/main`, `origin/master`, `origin/develop`, `main`, `master`; OTHERWISE it SHALL return the current branch name. |
| FR-GIT-200 | WHEN `getBranchFiles` is called with a base ref, the system SHALL diff the working tree against the merge base of that ref and `HEAD` — excluding commits the base gained after the fork point while still including uncommitted changes — and SHALL return that merge base alongside the file list. |
| FR-GIT-210 | IF no merge base exists between the supplied base ref and `HEAD`, THEN `getBranchFiles` SHALL diff against the base ref directly; IF that ref does not resolve, THEN the diff SHALL fail rather than return an empty file list. |
| FR-GIT-220 | WHEN `getBranchFiles` is called, the system SHALL additionally report untracked files as `added`, excluding any path matched by the repository's ignore rules; IF a path is reported by both the diff and the untracked listing, THEN the system SHALL emit only the diff's entry. |
| FR-GIT-230 | WHEN `getStatusDetailed` or `getBranchFiles` returns a path, the system SHALL include a `contentId` identifying that path's own on-disk state — stable across calls while untouched, different once modified, and derived from a symlink itself rather than its target; IF the path is deleted, is a directory, or is a submodule gitlink, THEN `contentId` SHALL be omitted. |

## Sources

No prior knowledge found.
