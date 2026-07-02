---
title: PR/CI Monitoring
status: complete
---

# Plan: M11 PR/CI Monitoring

## Overview

M11 delivers automated monitoring of open GitHub PRs: a Project PRs tab listing open PRs across workspace repos with live CI status, a polling loop that reads PR state via the `gh` CLI (executed by the client daemon, never the server), auto-dispatch of agent sessions for mechanical CI failures (lint, type errors, missing deps), and reviewer comment triage — GitHub review comments pulled into the diff viewer where the user selects which to address and dispatches an agent with the selection as context. Covers spec FR-11.1 through FR-11.8.

Boundary: no GitHub write operations (no posting replies, no dismissing reviews on GitHub — dismissal is local only), no webhooks (polling only), no full notification center (M8 scope — M11 ships a minimal broadcast + toast + attention-badge path), no GitLab/Bitbucket, no merge automation.

## Codebase Context

Explored 2026-07-01. Key facts the implementer must know:

- **`gh` CLI is greenfield.** Not used anywhere today (only appears in the devcontainer package list in `client/src/container/config-generator.ts`). PR creation is fully delegated to agents via prompt (`buildContextBlock` in `web/src/lib/shell.ts` appends "push your branch and create a pull request" when `workspaces.autoAgentCompletion = 'pr'`). **The server never learns the PR URL** — no `prUrl`/`prNumber` exists in schema, routers, or protocol. The only branch record is `agentSessions.branch` + `agentSessions.worktreePath`. M11 correlates PRs to work by matching `gh pr list` head branches against `agentSessions.branch` ("agent pushes, system observes").
- **WS protocol** (`common/src/ws/protocol.ts`): every message is `{ type: 'SCREAMING_SNAKE', payload }`, request/response correlated via `payload.requestId`, responses are success-shape OR `{ requestId, error }`. Git messages carry `repoDir` + optional `coderWorkspace`. New messages must be added to all three unions (`WsMessage`, `ClientToServerMessage`, `ServerToClientMessage`) with a section comment.
- **Daemon git execution** (`client/src/git/index.ts`): injectable `GitRunner` pattern — `localGitRunner` wraps `execFileAsync('git', args, { maxBuffer: EXEC_MAX_BUFFER })`. A gh module mirrors this. Handlers register as `case` branches + `private async handleXxxRequest` in `client/src/ws/client.ts` (closest template: `handleGitLogRequest`).
- **Server WS dispatch** (`web/src/server/ws/server.ts`): all daemon ops MUST use the generic `dispatchDaemonOp(state, pendingMap, messageType, payload, timeoutMs)` (per `web/src/server/ws/CLAUDE.md`). Pending maps live on `AppState` (`web/src/server/trpc/context.ts`) and must be appended to `rejectAllPending()`. Match `dispatchGitLog`'s signature style (state last) and `GIT_TIMEOUT_MS = 15_000`. Browser push goes through the `ServerEvent` union + typed wrapper in `web/src/server/ws/broadcast.ts` (template: `broadcastTaskChange`); UI subscribes via `useOnServerEvent` from `web/src/contexts/events-context.tsx`.
- **Agent dispatch (M9)** (`web/src/server/trpc/routers/execution.ts`): `startExecution` builds prompts and calls `dispatchExecutionStart`; **`sendFeedback` is the template for CI-fix dispatch** — it resumes a session with `--resume <sessionId>` and `buildResumeConfig(taskId, session.worktreePath)` so the agent works in the existing worktree/branch. **`triggerAutoStart(caller, taskId, state)` is the precedent for automated (non-user) dispatch**: daemon-readiness check → workspace gating flag → `maxConcurrency` check against active `agentSessions` → fire-and-forget with logged `.catch`.
- **Diff comments (M5)**: `commentThreads` + `threadComments` tables (the legacy `comments` table is TODO-marked — do not build on it). Threads attach via `documentPath`; diff line info lives in the thread's `metadata` JSON. `useDiffComments(repoDir)` (`web/src/components/diff/use-diff-comments.ts`) shapes them; `ReviewActions` (`web/src/components/diff/review-actions.tsx`) aggregates unresolved threads via `generateDiffFeedback` (`feedback-markdown.ts`) into `trpc.execution.sendFeedback`. GitHub reviewer comments slot in as threads with `metadata: { source: 'github', ... }` and reuse this pipeline.
- **PRs tab placeholder already exists**: `web/src/components/layout/header/sections.ts` has `{ label: 'PRs', segment: 'prs', icon: RiGitPullRequestLine, disabled: true, hint: 'Coming soon' }`. Activate by removing `disabled`/`hint` and adding a route at `web/src/app/w/[workspace]/projects/[project]/prs/page.tsx` (thin wrapper delegating to `web/src/components/prs/`, matching `diffs/page.tsx` → `DiffsPage`).
- **Notification system does not exist** (spec FR-8.3/8.4 unimplemented). Available signaling: sonner toasts, `/ws/events` broadcasts, and badge precedents (`project-activity-badge.tsx`, `execution-status-icon.tsx`). M11 ships the minimal path only.
- **Polling precedent**: only server-side interval is the MCP session sweep (`setInterval` in `web/src/server/mcp/index.ts`). **Decision: the PR poller is a server-side interval** that calls the gh dispatch wrappers per repo — DB writes, correlation, and broadcasts all live server-side, matching how all other daemon data is pulled. Timers held on `AppState` and torn down like the spec-watcher debounce timers.
- **GitHub auth rides on the user's existing `gh auth login`** (researched 2026-07-01). The daemon shells out to `gh`, which resolves its own OAuth token from the macOS Keychain — Engy never sees, stores, or refreshes a token, and no OAuth app registration is needed. This is guaranteed-available: M6 agents already run `gh pr create`, so a working `gh` login is a standing prerequisite. Alternatives rejected: Octokit + `@octokit/auth-oauth-device` (requires registering an OAuth app, building token storage + refresh — keychain integration is extra work and a file/DB fallback is strictly worse than gh's keychain); fine-grained PAT pasted into settings (secret lands in Engy's SQLite, and fine-grained PATs have a known `statusCheckRollup` failure on org-private repos — cli/cli#12597). Preflight with `gh auth status` for the descriptive error state. Efficiency note: `gh pr list --json number,title,url,headRefName,author,isDraft,state,reviewDecision,statusCheckRollup,updatedAt` returns list + CI rollup in ONE call — a separate per-PR checks call is only needed for TG2's failed-log detail.
- **Schema rules** (`web/src/server/db/CLAUDE.md`): single `schema.ts` with section comments, integer PKs, ISO-string timestamps, `text({ enum })`, JSON via `text({ mode: 'json' }).$type<T>()`, explicit `onDelete`, `pnpm drizzle-kit generate`, never hand-edit migrations. CI check results go in a JSON column on `prs` (we only filter on a summary `ciStatus` enum column, never inside the JSON).
- **Testing gotchas**: WS server tests bind real sockets — run unsandboxed; web WS suites flake under turbo load (verify with standalone `pnpm vitest run`).

Previous milestones shipped: M6 worktrees + task-group lifecycle + agent-driven PR creation; M9 persistent agent sessions with resume + feedback routing + auto-start; M10 dev containers (`client/src/container/`). M8's notification center has not been built.

## Task Group Sequencing

- **TG1: PR Data Layer & PRs Tab** — no dependencies. Can start immediately. Establishes the gh protocol trio (common/client/web), `prs` table, poller, and PRs tab.
- **TG2: CI Failure Auto-Fix & Alerts** — depends on TG1 (poller detects CI transitions; `prs` table stores attempt state; PR rows surface attention states).
- **TG3: Reviewer Comment Triage** — depends on TG1 (gh module + poller + `prs` table). Independent of TG2 in behavior, but sequenced after it as stacked PRs because both extend the same poller and gh module files.

## TG1: PR Data Layer & PRs Tab

The core vertical slice: daemon-executed `gh` reads, a `prs` table, a server-side polling loop, and the PRs tab showing open PRs with CI status per PR. Everything later in M11 builds on this. Delivers spec FR-11.1 and FR-11.2 (status + checks; reviews/comments polling is extended in TG3).

### Requirements

1. The system shall define WS request/response message pairs for `gh` PR operations (`GH_PR_LIST`, `GH_AUTH_STATUS`) in `@engy/common`, following the existing `requestId` + `repoDir` + `coderWorkspace?` pattern, registered in all three protocol unions. *(inferred: FR-11.2 + server-never-touches-repos rule)* (FR-TG1.1)
2. The client daemon shall execute `gh pr list --json` (including `statusCheckRollup` — list + CI status in one call) via an injectable runner mirroring `GitRunner`, returning parsed results or a typed error, with a `gh auth status` preflight distinguishing "gh not installed" from "not authenticated". Auth is the user's existing `gh` login; Engy stores no tokens. *(inferred)* (FR-TG1.2)
3. The system shall persist open PRs in a `prs` table — repo, number, title, url, headBranch, author, state, `ciStatus` enum (`pending`/`passing`/`failing`/`unknown`), checks JSON, reviewDecision, timestamps — upserted keyed by (repo, number), and correlated to work by matching `headBranch` against `agentSessions.branch`. *(user request: FR-11.1)* (FR-TG1.3)
4. The system shall poll PR status on a server-side interval per workspace repo via the daemon dispatch wrappers, upsert results, mark vanished PRs closed, and broadcast a `pr-change` server event on material change. *(user request: FR-11.2)* (FR-TG1.4)
5. The system shall provide a Project PRs tab listing open PRs across repos with per-PR CI status, check breakdown, review decision, linked agent session (when correlated), and a manual Refresh action; the tab updates live on `pr-change` events. *(user request: FR-11.1)* (FR-TG1.5)
6. When no daemon is connected or `gh` is unavailable, the PRs tab shall show a descriptive empty/error state instead of failing silently. *(inferred: fail-fast DX)* (FR-TG1.6)

### Tasks

1. **gh WS protocol + daemon gh module + server dispatch wrappers**
   - Files: `common/src/ws/protocol.ts` [MODIFY], `client/src/gh/index.ts` [NEW], `client/src/gh/index.test.ts` [NEW], `client/src/ws/client.ts` [MODIFY], `client/src/ws/client.test.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY], `web/src/server/ws/server.test.ts` [MODIFY], `web/src/server/trpc/context.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.2
   - Add `GH_PR_LIST_REQUEST/RESPONSE` (and `GH_AUTH_STATUS_REQUEST/RESPONSE` preflight) under a new `// ── GitHub PR operations ──` section — one list call with `statusCheckRollup` covers CI status, no separate checks op in TG1; daemon module with `localGhRunner` (execFile `gh`, `EXEC_MAX_BUFFER`), JSON parsing, and typed not-installed / not-authenticated errors; `case` + `handleGhPrListRequest`/`handleGhPrChecksRequest` in the daemon WS client (template: `handleGitLogRequest`); server-side `dispatchGhPrList`/`dispatchGhPrChecks` via `dispatchDaemonOp` with `GIT_TIMEOUT_MS`, pending maps on `AppState` added to `rejectAllPending()`. Protocol + handler + dispatch are one atomic, testable unit. Verify: `pnpm blt` (WS tests unsandboxed).
   - Type: ai. Important + urgent (critical path). **Plan-warranted** (cross-cutting protocol change, 3 packages) → `/engy:plan` at TG-planning time.

2. **`prs` table + `pr` tRPC router** (depends on task 1)
   - Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/db/migrations/*` [GENERATED], `web/src/server/trpc/routers/pr.ts` [NEW], `web/src/server/trpc/routers/pr.test.ts` [NEW], `web/src/server/trpc/root.ts` [MODIFY]
   - Implements FR-TG1.3
   - `prs` table per schema rules (section comment, ISO timestamps, `ciStatus` enum column, `checks` JSON `.$type<PrCheck[]>()`, index on repo). Router: `list` (by workspace/project, joined with correlated `agentSessions` on branch match), `refresh` (dispatches gh ops for one repo and upserts — the shared upsert/correlate helper the poller will also use). Verify: `cd web && pnpm drizzle-kit generate`, `pnpm blt`.
   - Type: ai. Important + urgent.

3. **PR polling service** (depends on task 2)
   - Files: `web/src/server/pr/poller.ts` [NEW], `web/src/server/pr/poller.test.ts` [NEW], `web/src/server/ws/broadcast.ts` [MODIFY], `web/src/server/trpc/context.ts` [MODIFY], server bootstrap file that owns startup wiring [MODIFY]
   - Implements FR-TG1.4
   - Server-side `setInterval` (constant, ~60s; skip cycle when no daemon connected) iterating workspace repos, reusing the router's upsert/correlate helper; mark PRs absent from the list as closed; add `pr-change` to the `ServerEvent` union + `broadcastPrChange` wrapper (template: `broadcastTaskChange`); timer on `AppState`, torn down on shutdown alongside existing timers. Verify: `pnpm blt`.
   - Type: ai. Important + urgent.

4. **PRs tab UI** (depends on task 3)
   - Files: `web/src/components/layout/header/sections.ts` [MODIFY], `web/src/app/w/[workspace]/projects/[project]/prs/page.tsx` [NEW], `web/src/components/prs/prs-page.tsx` [NEW], `web/src/components/prs/pr-list.tsx` [NEW], plus pure helpers + `.test.ts` per web component test convention
   - Implements FR-TG1.5, FR-TG1.6
   - Enable the existing disabled `prs` section entry; thin page wrapper → `PrsPage` (template: `diffs/page.tsx` → `DiffsPage`); list rows with CI status pill, check breakdown, review decision, correlated session link, Refresh button (`trpc.pr.refresh`); live update via `useOnServerEvent('pr-change')`; empty/error states for no-daemon and gh-unavailable. Remixicon only. Verify: `pnpm blt` + playwright-cli.
   - Type: ai. Important + urgent.

**Parallelizable:** none — the chain is strictly sequential (1 → 2 → 3 → 4); tasks share the protocol/dispatch/broadcast touchpoint files.

### Completion Summary

_(filled in after TG completes)_

## TG2: CI Failure Auto-Fix & Alerts

When polling detects a PR's CI transitioning to failing, classify the failure; for mechanical failures on PRs correlated to an agent session, auto-dispatch a resume of that session in its existing worktree with the failure context; for everything else, alert the user. Delivers spec FR-11.3, FR-11.4, FR-11.8.

### Requirements

1. The system shall detect CI status transitions to `failing` during polling and classify failures as mechanical (lint, type errors, test failures, missing deps — heuristic on check names + `gh` failure output) or non-mechanical. *(user request: FR-11.3)* (FR-TG2.1)
2. The system shall fetch failing-check log excerpts via the daemon (`gh pr checks` / `gh run view --log-failed`) to include as dispatch context. *(inferred: agent needs the error text)* (FR-TG2.2)
3. When a mechanical CI failure occurs on a PR correlated to an agent session, and the workspace setting `autoCiFix` is enabled, the system shall auto-dispatch a session resume in the existing worktree with the failure context — gated by daemon readiness and `maxConcurrency`, capped at 2 auto-fix attempts per (PR, head commit) to prevent dispatch loops. *(user request: FR-11.3; cap inferred: loop safety)* (FR-TG2.3)
4. Agent CI fixes shall surface as new diffs in the existing diff viewer approve/feedback loop; the PR row shall link to the diffs tab for the correlated worktree. *(user request: FR-11.4)* (FR-TG2.4)
5. The system shall alert the user for unresolvable failures (non-mechanical, uncorrelated PR, attempt cap reached, or dispatch failed) via a `pr-attention` server event → toast + persistent attention badge on the PR row. *(user request: FR-11.8)* (FR-TG2.5)

### Tasks

1. **CI transition detection + failure classification + log fetch**
   - Files: `web/src/server/pr/ci-triage.ts` [NEW], `web/src/server/pr/ci-triage.test.ts` [NEW], `web/src/server/pr/poller.ts` [MODIFY], `web/src/server/db/schema.ts` [MODIFY] (+ generated migration: `prs.lastFailedHeadSha`, `prs.autoFixAttempts`, `prs.attentionReason`), `common/src/ws/protocol.ts` [MODIFY], `client/src/gh/index.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY]
   - Implements FR-TG2.1, FR-TG2.2
   - Pure classification helper (unit-tested) + `GH_PR_FAILED_LOGS` protocol op following TG1's established pattern. Verify: `pnpm blt`.
   - Type: ai. Important + not urgent. **Plan-warranted** (protocol extension + poller surgery).

2. **Auto-fix dispatch** (depends on task 1)
   - Files: `web/src/server/pr/auto-fix.ts` [NEW], `web/src/server/pr/auto-fix.test.ts` [NEW], `web/src/server/db/schema.ts` [MODIFY] (workspace `autoCiFix` flag + migration), workspace settings UI component [MODIFY], `web/src/lib/shell.ts` [MODIFY] (CI-fix prompt builder)
   - Implements FR-TG2.3
   - Mirror `triggerAutoStart` gating (daemon check → `autoCiFix` flag → `maxConcurrency`) and `sendFeedback`'s resume path (`--resume <sessionId>`, `buildResumeConfig` with existing worktree); increment attempt counter keyed by head SHA; fire-and-forget with logged `.catch` from the poller. Verify: `pnpm blt`.
   - Type: ai. Important + not urgent. **Plan-warranted** (touches execution engine, gating semantics).

3. **Attention surfacing + diffs link** (depends on task 2)
   - Files: `web/src/server/ws/broadcast.ts` [MODIFY] (`pr-attention` event), `web/src/components/prs/pr-list.tsx` [MODIFY], `web/src/components/prs/pr-attention.ts` [NEW] + test, toast wiring in `PrsPage`
   - Implements FR-TG2.4, FR-TG2.5
   - Attention badge with reason on PR rows, sonner toast on `pr-attention`, "View diffs" link to the diffs tab scoped to the correlated worktree. Verify: `pnpm blt` + playwright-cli.
   - Type: ai. Important + not urgent.

**Parallelizable:** none — sequential (1 → 2 → 3); shared poller/broadcast/schema files.

### Completion Summary

_(filled in after TG completes)_

## TG3: Reviewer Comment Triage

Pull GitHub review comments into the existing comment-thread system, render them in the diff viewer visually distinct from local comments, and let the user select a subset and dispatch a fix agent with those comments as context — or dismiss them locally. Delivers spec FR-11.5, FR-11.6, FR-11.7.

### Requirements

1. The system shall fetch PR review comments (file, line, body, author, GitHub id) via the daemon (`gh api` review-comments endpoint — `gh pr view --json` lacks file/line detail). *(user request: FR-11.5)* (FR-TG3.1)
2. The system shall import reviewer comments as `commentThreads`/`threadComments` rows with `metadata: { source: 'github', prNumber, githubId, path, line }`, idempotently keyed by GitHub id (re-polling never duplicates). *(user request: FR-11.5)* (FR-TG3.2)
3. The diff viewer shall render GitHub-sourced threads alongside local ones, visually distinct (author + GitHub badge), on the matching file/line of the PR branch diff. *(user request: FR-11.5)* (FR-TG3.3)
4. The system shall let the user select GitHub comment threads and dispatch "Fix Selected" — resuming the correlated agent session with the selected comments formatted as feedback context via the existing `generateDiffFeedback` → `sendFeedback` pipeline. *(user request: FR-11.6)* (FR-TG3.4)
5. The system shall support dismissing unselected GitHub threads (local resolve only — no GitHub write-back; responding on GitHub remains a manual, out-of-app action). *(user request: FR-11.7)* (FR-TG3.5)

### Tasks

1. **Review-comments fetch op + idempotent import**
   - Files: `common/src/ws/protocol.ts` [MODIFY], `client/src/gh/index.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY], `web/src/server/pr/review-sync.ts` [NEW], `web/src/server/pr/review-sync.test.ts` [NEW], `web/src/server/pr/poller.ts` [MODIFY]
   - Implements FR-TG3.1, FR-TG3.2
   - `GH_PR_REVIEW_COMMENTS` protocol op (pattern fully established by TG1); sync module upserting threads keyed by `metadata.githubId`, wired into the poll cycle for correlated PRs. Verify: `pnpm blt`.
   - Type: ai. Important + not urgent. **Plan-warranted** (thread-metadata contract with the diff viewer needs a design pass).

2. **Diff viewer triage UI + Fix Selected + dismiss** (depends on task 1)
   - Files: `web/src/components/diff/use-diff-comments.ts` [MODIFY], `web/src/components/diff/review-actions.tsx` [MODIFY], `web/src/components/diff/github-comment-triage.tsx` [NEW] + pure helper tests, `web/src/components/diff/feedback-markdown.ts` [MODIFY]
   - Implements FR-TG3.3, FR-TG3.4, FR-TG3.5
   - Extend `useDiffComments` to include GitHub-sourced threads with a `source` discriminator; distinct rendering; checkbox selection + "Fix Selected" building feedback from selected threads only → `trpc.execution.sendFeedback`; "Dismiss" → `trpc.comment.resolveThread`. Verify: `pnpm blt` + playwright-cli.
   - Type: ai. Important + not urgent. **Plan-warranted** (multi-file diff viewer integration).

**Parallelizable:** none — task 2 consumes the metadata contract task 1 establishes.

### Completion Summary

_(filled in after TG completes)_

## Out of Scope

- GitHub write operations — posting comment replies, resolving/dismissing reviews on GitHub, merging PRs (post-v1; dismissal in TG3 is local-only)
- Webhook-based updates (polling only, per FR-11.2)
- Full notification center with history/read-state (M8 scope; M11 ships toast + attention badge only)
- Auto-fix for uncorrelated PRs (no known worktree/session to resume; alert instead)
- GitLab/Bitbucket support (post-v1, per spec §9)
- Configurable poll interval UI (constant to start; revisit if needed)
