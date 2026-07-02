---
description: PR listing with live CI status, polling via the gh CLI, CI failure auto-fix dispatch, and reviewer comment triage in the diff viewer.
order: 16
---

# PR/CI Monitoring

Engy monitors open GitHub PRs for each workspace repo: it polls PR state through the user's existing `gh` CLI login (no token stored by Engy), surfaces live CI status in a dedicated PRs tab, auto-dispatches agent sessions to fix mechanical CI failures, and imports reviewer comments into the diff viewer for selective triage.

## Architecture

All GitHub I/O flows through the daemon over four protocol ops (`GH_PR_LIST`, `GH_AUTH_STATUS`, `GH_PR_FAILED_LOGS`, `GH_PR_REVIEW_COMMENTS`). The server never runs `gh` directly. The client daemon module is `client/src/gh/index.ts` with an injectable `GhRunner` mirroring the `GitRunner` pattern. Auth rides the user's existing `gh auth login` (macOS Keychain) — Engy never stores, sees, or refreshes tokens; `checkAuthStatus` preflights with `gh auth status` to provide a descriptive error state.

A self-scheduling `setTimeout` chain in `web/src/server/pr/poller.ts` drives each poll cycle every `POLL_INTERVAL_MS` (60 s). A slow cycle (many repos × dispatch timeout) never overlaps the next. Each cycle:

1. Skips if no daemon is connected.
2. Dispatches `GH_PR_LIST_REQUEST` per workspace repo via `dispatchGhPrList` in `web/src/server/ws/server.ts`.
3. Upserts results via `upsertPrs` in `web/src/server/trpc/routers/pr.ts`, which tracks material changes in a transaction.
4. On material change, broadcasts `PR_CHANGE` via `broadcastPrChange` in `web/src/server/ws/broadcast.ts`.
5. Clears `prs.attentionReason` for PRs whose `ciStatus` just transitioned to `'passing'`.
6. For PRs that newly transitioned to `'failing'`, hands off to `handleFailingPr`, which fetches log excerpts (`GH_PR_FAILED_LOGS`) and invokes `maybeDispatchCiFix` in `web/src/server/pr/auto-fix.ts`.
7. Syncs review comments for open correlated PRs whose `updatedAt` changed since the last sync, via `dispatchGhPrReviewComments` + `syncReviewComments` in `web/src/server/pr/review-sync.ts`.

Errors on a per-repo basis are logged once and gated (`state.prPollerErroredRepos`); the gate clears on recovery to prevent log spam.

## PRs tab

The route lives at `web/src/app/w/[workspace]/projects/[project]/prs/page.tsx`, dispatched via the `'prs'` case in `web/src/components/tabs/tab-content.tsx`. The section is enabled in `web/src/components/layout/header/sections.ts`. The page component is `web/src/components/prs/prs-page.tsx`; the list is rendered by `web/src/components/prs/pr-list.tsx`.

Each PR row shows: CI status pill (styled via `pr-helpers.ts`), check breakdown, review decision, correlated agent session link, and an attention badge (`web/src/components/prs/pr-attention.ts`) with a shadcn Tooltip when `prs.attentionReason` is set. A manual Refresh button calls `trpc.pr.refresh`. The list updates live via `useOnServerEvent('PR_CHANGE')`.

## PR–session correlation

`findCorrelatedSession` (in `web/src/server/trpc/routers/pr.ts`) matches `agentSessions.branch` against a PR's `headBranch` and `projects.projectDir` against the PR's `repo`. It queries both group-mode sessions (via `taskGroup → project`) and task-mode sessions (via `task → project` with `taskGroupId null`), returning the most-recent-by-`createdAt` winner. The `pr.list` procedure applies the same logic in batch for the PRs tab listing.

## prs table schema

Key columns: `repo`, `number`, `title`, `url`, `headBranch`, `headSha`, `author`, `isDraft`, `state` (`open`/`closed`/`merged`), `ciStatus` (`pending`/`passing`/`failing`/`unknown`), `checks` (JSON), `reviewDecision`, `lastFailedHeadSha`, `autoFixAttempts`, `autoFixTotalAttempts`, `attentionReason`. Added in migrations 0023–0026.

## CI failure detection and auto-fix

`web/src/server/pr/ci-triage.ts` provides:
- `detectFailureTransitions(changes)` — filters `MaterialChange[]` from `upsertPrs` to entries with `type:'ciStatus'` and `current:'failing'`.
- `isFailingCheck(check)` — returns true for checks with failing conclusions or `FAILURE`/`ERROR` status. The poller passes only failing checks to `classifyFailure` to prevent passing checks with mechanical names from triggering false positives.
- `classifyFailure(checks, logExcerpts)` — returns `'mechanical'` if any failing check name or log excerpt matches code-quality/tooling patterns; `'non-mechanical'` otherwise (conservative default).

`maybeDispatchCiFix` in `web/src/server/pr/auto-fix.ts` gates auto-dispatch on eight conditions in order (see FR-PRMON-090). On all gates passing, it increments `prs.autoFixAttempts` and `prs.autoFixTotalAttempts`, sets the session to `'active'`, and dispatches `EXECUTION_START_REQUEST` with `--resume <sessionId>` and a CI-fix prompt (`buildCiFixPrompt` in `web/src/lib/shell.ts`). If `dispatchExecutionStart` throws, both counters and session status are rolled back.

The per-headSha cap (`autoFixAttempts < 2`) resets when `headSha` changes on a new failure. The total cap (`autoFixTotalAttempts < 5`) prevents cross-commit dispatch loops. Auto-fix is default off (`workspace.autoCiFix = false`); the toggle lives in the workspace edit dialog.

## Attention states

`prs.attentionReason` is set by `maybeDispatchCiFix` for: non-mechanical failure, uncorrelated PR, attempt-cap hit, session without a worktree. It is cleared when a CI fix is dispatched, when `ciStatus` transitions to `'passing'` in the poll cycle, or when the PR leaves `'open'` state (close/merge/vanish via `upsertPrs`). On set, `broadcastPrAttention` fires a `PR_ATTENTION` server event that triggers a sonner toast in the PRs page.

## Reviewer comment triage

`GH_PR_REVIEW_COMMENTS` fetches review comments via `gh api repos/{o}/{r}/pulls/{n}/comments --paginate --slurp` (slurp is required: plain `--paginate` emits one JSON array per page, causing `JSON.parse` to fail on multi-page results). `syncReviewComments` in `web/src/server/pr/review-sync.ts` imports them into `commentThreads` / `threadComments` keyed by deterministic ids (`gh-thread-{githubId}` / `gh-comment-{githubId}`), with `documentPath: diff://{repo}/{path}` and `metadata.source: 'github'`. Locally-resolved threads are never auto-unresolved. Comments deleted on GitHub are preserved locally.

The diff viewer's triage bar (`web/src/components/diff/github-comment-triage.tsx`) renders when unresolved GitHub threads exist. Users select threads via checkboxes (helpers in `web/src/components/diff/github-triage-helpers.ts`); "Fix Selected" formats selected threads via injection-hardened blockquoted markdown (`generateGithubFeedback`) and calls `trpc.execution.sendFeedback` on the correlated session. "Dismiss" calls `trpc.comment.resolveThread` locally — no GitHub write-back.

## Out of scope

No GitHub write operations (no posting replies, no resolving reviews on GitHub), no webhooks (polling only), no notification center (toast + attention badge only), no GitLab/Bitbucket, no auto-fix for uncorrelated PRs.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-PRMON-010 | WHEN `listOpenPrs` is called, the system SHALL invoke `gh pr list --json` including `statusCheckRollup` and derive `ciStatus` from the rollup: return `'failing'` immediately on any `CheckRun` with a failing conclusion (`failure`, `timed_out`, `action_required`, `cancelled`, `startup_failure`) or any `StatusContext` with state `FAILURE` or `ERROR`; return `'pending'` if no failure and at least one entry is in-progress/queued/pending; return `'passing'` otherwise; return `'unknown'` for an absent or empty rollup. |
| FR-PRMON-020 | WHEN `checkAuthStatus` is called, the system SHALL return `{ ok: true }` if `gh auth status` exits zero; return `{ ok: false, reason: 'not-installed' }` IF the process exits with `ENOENT`; return `{ ok: false, reason: 'not-authenticated' }` IF stderr or the error message contains known auth-failure phrases (`not logged in`, `gh auth login`, `run gh auth`); and propagate the error for all other unexpected failures. |
| FR-PRMON-030 | The system SHALL persist PRs in a `prs` table keyed by `(repo, number)` via `upsertPrs`; on re-poll the system SHALL update all fields, report material changes (`new`, `ciStatus`, `state`, `reviewDecision`), mark open PRs absent from the incoming list as `'closed'`, clear `attentionReason` and `lastFailedHeadSha` when a PR leaves `'open'` state, and perform all writes in a single transaction. |
| FR-PRMON-040 | WHEN `findCorrelatedSession` resolves PR-to-session correlation, the system SHALL match `agentSessions.branch` against the PR's `headBranch` and `projects.projectDir` against the PR's `repo`, querying both group-mode sessions (via `taskGroup → project`) and task-mode sessions (via `task → project` with `taskGroupId` null), and returning the most-recent-by-`createdAt` session. |
| FR-PRMON-050 | WHEN a poll cycle runs and the daemon `readyState` is `OPEN`, the system SHALL dispatch `GH_PR_LIST_REQUEST` per workspace repo, upsert results via `upsertPrs`, and call `broadcastPrChange(workspaceId, repo)` when `upsertPrs` reports at least one material change; IF the daemon is not connected or not `OPEN`, the system SHALL skip the entire cycle. |
| FR-PRMON-060 | WHEN `detectFailureTransitions` is called with a `MaterialChange[]`, the system SHALL return only entries with `type: 'ciStatus'` and `current: 'failing'`. |
| FR-PRMON-070 | WHEN `classifyFailure` is called with failing check data and log excerpts, the system SHALL return `'mechanical'` if any failing check's name or any log's check name or excerpt text matches a code-quality/tooling pattern (lint, eslint, typecheck, tsc, typescript, test, vitest, jest, build, knip, format, prettier, deps, install; log signals: `'error ts'`, `'eslint'`, `'fail '`, `'cannot find module'`, `'eresolve'`, `'typeerror'`, `'syntaxerror'`), and `'non-mechanical'` otherwise (conservative: no-match → non-mechanical). |
| FR-PRMON-080 | WHEN `fetchFailedLogs` is called, the system SHALL invoke `gh pr checks` to identify checks with `bucket: 'fail'`, group Actions checks by run ID, invoke `gh run view <runId> --log-failed` once per unique run ID, truncate output to the last 200 lines or 16 KB (tail-preserving), redact common token patterns (`ghp_`, `gho_`, `github_pat_`, `AKIA`, `Bearer …`, `xox…`), return empty excerpts for non-Actions checks, and treat log-fetch errors as non-fatal. |
| FR-PRMON-090 | WHEN `maybeDispatchCiFix` is called, the system SHALL skip dispatch and return `{ dispatched: false, reason }` if any gate fails in order: (1) classification is not `'mechanical'`; (2) `workspace.autoCiFix` is falsy; (3) daemon is not connected; (4) no correlated session found for the PR's `headBranch` and `repo`; (5) active session count for the workspace meets `maxConcurrency`; (6) `prs.autoFixAttempts ≥ 2` (per-headSha cap); (7) `prs.autoFixTotalAttempts ≥ 5` (cross-commit total cap); (8) correlated session has no `worktreePath`. |
| FR-PRMON-100 | WHEN `maybeDispatchCiFix` passes all gates, the system SHALL increment `prs.autoFixAttempts` and `prs.autoFixTotalAttempts`, set the correlated session to `status: 'active'`, dispatch `EXECUTION_START_REQUEST` with `--resume <sessionId>` and a CI-fix prompt, and clear `prs.attentionReason`; IF `dispatchExecutionStart` throws, the system SHALL roll back both counters and the session status to their pre-dispatch values before re-throwing. |
| FR-PRMON-110 | WHEN a CI failure is `'non-mechanical'`, the PR is uncorrelated, an attempt cap is reached, or the correlated session has no worktree, the system SHALL set `prs.attentionReason` to a descriptive reason string and broadcast a `pr-attention` event; `attentionReason` SHALL be cleared when a CI fix is successfully dispatched, when a poll cycle detects `ciStatus` transitioning to `'passing'`, or when the PR leaves `'open'` state. |
| FR-PRMON-120 | The PRs tab SHALL list open PRs for all workspace repos ordered by `updatedAt` descending, showing per-PR CI status pill, check breakdown, review decision, correlated agent session link, and a manual Refresh action. |
| FR-PRMON-130 | IF no daemon is connected, `gh` is not installed, or `gh` is not authenticated, THEN the PRs tab SHALL show a descriptive error state rather than failing silently. |
| FR-PRMON-140 | WHILE the PRs tab is mounted, the system SHALL refresh the displayed PR list in response to `PR_CHANGE` server events without requiring a page reload. |
| FR-PRMON-150 | WHEN `fetchReviewComments` is called, the system SHALL resolve the repo's `{owner}/{repo}` via `gh repo view --json nameWithOwner`, then call `gh api repos/{owner}/{repo}/pulls/{n}/comments --paginate --slurp`, flat-merge the resulting array-of-arrays into a unified list, and map each entry to `GhReviewComment` shape, preferring `line` over `original_line` and mapping `in_reply_to_id` to `inReplyToId`. |
| FR-PRMON-160 | The system SHALL import GitHub review comments idempotently as `commentThreads` / `threadComments` rows, keying threads by `gh-thread-{githubId}` and comments by `gh-comment-{githubId}`; thread `documentPath` SHALL be `diff://{repo}/{path}`; re-sync SHALL update edited bodies without duplicating rows, SHALL NOT auto-unresolve locally-resolved threads, and SHALL preserve comments deleted on GitHub. |
| FR-PRMON-170 | The diff viewer's GitHub triage bar SHALL render unresolved GitHub-sourced threads read-only with author attribution; users SHALL be able to select threads via checkboxes and dispatch "Fix Selected" which formats selected threads via injection-hardened blockquoted feedback markdown and calls `trpc.execution.sendFeedback` on the correlated session; "Dismiss" SHALL resolve threads locally via `trpc.comment.resolveThread` without any GitHub write-back. |

## Sources

No prior knowledge found.
