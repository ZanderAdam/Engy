---
title: PR Inbox & Review
status: draft
---

# Plan: M15 PR Inbox & Review

## Overview

M15 turns the PRs tab into a full review loop, modelled on Linear Inbox and Linear Diffs. It adds three things:

1. **One global Inbox for PR events.** One row per PR. Review requests, mentions, comments, reviews on my PRs, CI failures and merges arrive here. The Inbox is keyboard-first (`j`/`k`, `u`, `e`, `h`) and has a Priority tab. The selected PR opens in a preview pane.
2. **An in-app PR review page.** It has an overview, a conversation, checks and a files diff. The diff is built from a review worktree that the system makes and removes by itself. GitHub review threads sync both ways.
3. **Review writes to GitHub.** You can post comments and replies, resolve threads, submit a review (approve, request changes or comment) and mark notifications as read. Agent findings stay local until you add them to your review.

M15 also moves all GitHub API calls from the daemon (`gh` CLI) to a server-side client. The client uses a token from `ENGY_GITHUB_TOKEN`.

Boundary:
- no merge or auto-merge
- no webhooks (polling only)
- no GitHub Enterprise or second host
- no GitLab or Bitbucket
- no agent events in the Inbox (questions, terminal attention and M12 conveyor halts stay on their current surfaces)
- no sync of GitHub's per-file "viewed" flag
- no stacked-PR tooling

## Key Decisions

User decisions (2026-09-30):

1. **Inbox holds PR events only.** Agent attention (questions badge, terminal `needsAttention`, M12's planned "needs me" popover) is not merged in. The data model keys items by PR, so adding other sources later means adding a new subject kind (see Open Questions).
2. **One global Inbox across all workspaces**, with a workspace filter. GitHub notifications are per account, so this matches the source. When a PR's repo is in no workspace, its row shows "Open on GitHub" only, with the hint "Add this repo to a workspace to review it in Engy".
3. **GitHub calls run on the server with a token from the env file.** The user sets `ENGY_GITHUB_TOKEN` in `.env` / `.dev.env`, created with `gh auth token`. The server never gets the token any other way and never stores it in the DB. This replaces the M11 decision "daemon shells out to `gh`, Engy never sees a token". The reasons:
   - Conditional polling of notifications is cheap: a `304` does not count against the rate limit.
   - Resolving review threads needs GraphQL.
   - Each `gh` call cost one process spawn plus one WS round trip.
   - Coder workspaces no longer need a `gh` exec path.
4. **Review writes, no merge.** You can post inline comments, replies and top-level comments, resolve and unresolve threads, submit a review, and mark notifications read or done.
5. **Always a worktree, with auto cleanup.** When you open a PR for review, the system creates a review worktree, unless a worktree for that PR's branch already exists (for example, your own agent's worktree). Cleanup runs only when you open a new PR for review: that step removes the older review worktrees. There is no timer and no poller cleanup (user decision, 2026-09-30).

Planning decisions (this plan):

6. **Two event sources, no overlap.**
   - The GitHub Notifications API is the source for **people events**: review requested, mention, comment, review submitted, assign, state change.
   - The M11 poller is the source for **machine events**: CI failing and passing transitions, and auto-fix attention.
   - The GitHub `ci_activity` reason is dropped, so each CI event arrives once.
7. **Notification detail comes from the PR timeline.** A notification carries only a reason and `latest_comment_url`. When a notification thread updates, the system fetches the PR's `timelineItems(since: lastSyncedAt)` through one GraphQL query and writes concrete events such as "alice approved" or "bob commented on `foo.ts:42`".
8. **GitHub drafts wait for Submit.** A GitHub comment you write on the review page is stored as a draft (`metadata.githubDraft: true`). **Submit review** sends all drafts plus the verdict in one `POST /pulls/{n}/reviews` call. Replies to existing GitHub threads post at once, because the reviews API cannot hold replies. This matches GitHub's pending-review model without syncing GitHub pending reviews.
9. **Two comment types that never mix (user decision, 2026-09-30).**
   - **Engy comments** are local user notes and agent findings (`source: 'local'` / `'agent'`). They never go to GitHub. No action copies or promotes them to GitHub. Their outlets are the ones that exist today: Send to agent, Resolve, Copy.
   - **GitHub comments** are drafts you wrote as GitHub comments, plus threads imported from GitHub (`source: 'github'`).
   - The type is chosen when the comment is created. The composer has two separate buttons, **Add note** (Engy) and **Add to GitHub review** (draft). There is no default that can post by mistake.
   - Submit collects **only** rows with `githubDraft: true`. A test proves that local and agent threads on the same diff key are never sent.
   - The two types look different: GitHub rows carry the GitHub badge and "Pending" for drafts; Engy rows carry "Local only".
10. **GitHub is the source of truth for GitHub threads.** Resolve and unresolve write to GitHub, and the next sync mirrors GitHub's state, including an unresolve done on github.com. This replaces the M11 rule "a locally resolved thread never auto-unresolves" (FR-PRMON-160/170). A local-only dismiss is kept only as the fallback when GitHub returns `403`.
11. **Thin `fetch` client, no Octokit.** The client has two functions, `githubRest` and `githubGraphql`. They share typed errors, Link-header pagination and rate-limit header capture. There is no new dependency, and the `--slurp` pagination trap goes away.

## Linear Reference

Sources: linear.app/docs/inbox, /docs/notifications, /changelog/2026-09-03-priority-inbox, /docs/diffs, /changelog/2026-05-27-linear-diffs, /now/reviewing-code-in-the-agent-era.

| Linear feature | M15 |
|---|---|
| One inbox row per issue/PR, latest event as summary | TG2, TG3 |
| `j`/`k`, `u` read, `Alt+u` all read, `h` snooze, `Backspace` delete, `g i` open | TG3 (`e` and `Backspace` both mark done) |
| Priority tab ("needs you now" vs "can wait") | TG3, fixed rules; no custom filter |
| Email only if still unread | Not copied. Optional browser notification for Priority items (TG3 task 4) |
| Reviews list: For me / Created, sorted by closeness to shipping | TG5 extends the PRs tab (Mine/Review exists) |
| Diff: unified/split, file tree, structural highlighting | Split/unified and tree exist. Structural highlighting is out of scope |
| File classes via `.gitattributes`; "meaningful lines" count | TG5 |
| Approve / request changes / submit review | TG6 |
| Inline feedback: to agent / add to review / post | Not copied. Engy and GitHub comments stay separate (decision 9) |
| Guided review chapters, risk score | TG7 (reading order + risk in the agent review summary, shaped by a review guide that each Engy project can override) |
| Agent comments show agent, model, "on behalf of" | Agent threads already show `agentType`. They stay local, so no "on behalf of" is needed |
| Merge, auto-merge, merge queue | Out of scope |

## Codebase Context

Explored 2026-09-30.

**M11 pipeline (base for M15)**
- The daemon has 3 GitHub ops: `GH_PR_LIST`, `GH_PR_FAILED_LOGS` and `GH_PR_REVIEW_COMMENTS`.
  - Protocol: `common/src/ws/protocol.ts:735-820`.
  - Daemon implementation: `client/src/gh/index.ts`, with an injectable `GhRunner`.
  - Daemon handlers: `client/src/ws/client.ts:661-667, ~1544, ~1562`, plus a Coder exec path at `:754`.
  - Server dispatchers: `web/src/server/ws/server.ts:1395-1421`.
  - TG1 deletes all of these.
- `listOpenPrs` (`client/src/gh/index.ts:130-157`) runs `gh pr list --limit 100` twice per repo (`--author @me` and `--search review-requested:@me`). It sets `authoredByViewer`.
- **Poller** (`web/src/server/pr/poller.ts`): a self-scheduling 60 s `setTimeout` chain. For each workspace repo it lists PRs, calls `upsertPrs`, broadcasts `PR_CHANGE`, runs CI triage and auto-fix, and syncs review comments.
  - Review comments sync **only for PRs with a correlated agent session** (`poller.ts:67-68`). PRs where your review is requested usually have no such session, so their comments are never imported.
  - The sync is skipped when `updatedAt` has not changed (`state.prReviewCommentLastSyncedAt`).
- **`upsertPrs`** (`web/src/server/trpc/routers/pr.ts:104-205`) emits a `MaterialChange` of type `new`, `ciStatus`, `reviewDecision`, `commentCount` or `removed`. It **hard-deletes** PRs that are no longer open. The Inbox therefore needs its own tables for history.
- **`prs` table** (`web/src/server/db/schema.ts:476-513`):
  - Keyed by (repo path, number). No workspace FK.
  - No column for state, base branch, repo full name, requested reviewers, additions/deletions or body.
- **Auto-fix** (`web/src/server/pr/auto-fix.ts`, `ci-triage.ts`): `prs.attentionReason` plus the `PR_ATTENTION` broadcast. The toast shows only while the PRs page is mounted (`prs-page.tsx:183`). Keep the caps: 2 attempts per head SHA and 5 in total.

**Review comments**
- Review comments are generic `comment_threads` / `thread_comments` rows (`schema.ts:423-474`).
- Diff threads use `workspaceId: null` and the key `diff://<repoDir>#<encodeURIComponent(branch)>/<filePath>`. **Only** `diffDocPath` in `web/src/lib/diff-doc-path.ts` builds this key.
- Thread metadata:
  - `source`: `local`, `github` or `agent`
  - `type`: `diff` or `review-summary`
  - GitHub fields: `prNumber`, `githubId`, `path`, `line`, `author`, `url`
- **Import** (`web/src/server/pr/review-sync.ts`): REST `pulls/{n}/comments`, idempotent ids `gh-thread-{id}` / `gh-comment-{id}`, keyed on the PR `headBranch`.
  - Known gap: a force-push that moves a line does not relocate the thread (`review-sync.ts:27-29`).
  - Issue comments and review bodies are never imported.
- **Agent review tools** (`web/src/server/mcp/diff-review-tools.ts`): `diff_review_comment`, `diff_review_summary`, `diff_review_list` and `diff_review_resolve`.
  - `repoDir` defaults to the calling session's cwd.
  - **The branch comes from the daemon (`dispatchGitBranch`, `:99-110`).** A review worktree on a local branch named differently from the PR head would therefore key threads wrongly. TG4 handles this.
- **Diff UI**:
  - `web/src/components/diff/diffs-page.tsx` (991 lines) uses react-diff-view with the modes `latest`, `history` and `branch`. It always diffs a local checkout through daemon git calls (`web/src/server/trpc/routers/diff.ts`).
  - Deep links: `?diffRepo`, `?diffBranch`, `?diffView` (`diff-url-params.ts`).
  - Stack view is capped at `MAX_MOUNTED_SECTIONS = 25`.
  - Viewed state is kept in localStorage (`use-viewed-files.ts`).
  - GitHub triage: `github-comment-triage.tsx` offers "Fix Selected" and a local "Dismiss". It shows only threads on files in the current diff (`diffs-page.tsx:707-715`).
  - Review dispatch: `review-actions.tsx` "Review diff" sends `buildReviewPrompt` (`/engy:review-diff`) to the active terminal. It is disabled in Coder.

**Worktrees and git**
- `WORKTREE_ADD_REQUEST` (`protocol.ts:540`) takes `{repoDir, worktreePath, branch, createBranch, baseRef?}`. `WORKTREE_REMOVE_REQUEST` takes `force`.
- The dispatchers are at `server.ts:1355,1375`. Project worktrees go under `getWorkspaceDir(ws)/worktrees/<project>/<branch>/<repo>` (`web/src/server/engy-dir/init.ts:224`).
- `GIT_FETCH_REQUEST` (`protocol.ts:254`) fetches only the remote of a `base` ref. It has **no refspec**, so fetching `pull/N/head` needs a protocol change.

**Attention and notifications**
- No notification center, inbox, unread state or read tracking exists.
- The closest thing to an inbox is the header question badge and popover (`web/src/components/header-actions.tsx:13-66`), which also owns the `Cmd+K` key handler.
- Server events: the `ServerEventMap` in `web/src/contexts/events-context.tsx:103` and the wrappers in `web/src/server/ws/broadcast.ts`.
- Task #995, "Browser notifications on terminal Stop/Notification hooks", is in review. TG3 task 4 reuses its notification helper.

**Tabs and routing**
- Tabs render by virtual path in `web/src/components/tabs/tab-content.tsx`, using `dispatchProject` / `dispatchWorkspace` plus top-level checks such as `/open`.
- **A new section needs the route page AND a case in this switch** (M11 gotcha).

**Env**
- `pnpm dev` loads `.dev.env` and `pnpm start` loads `.env` through `dotenv-cli` (root `package.json:6-7`).
- `ecosystem.config.js` builds the env for each process explicitly (`:27`, `:33`).

**Feature docs**
- `docs/system/features/pr-monitoring.md` (FR-PRMON-010…190, with an "Out of scope" section that M15 rewrites).
- `git-and-worktree.md` (FR-GIT-300…500, diff surface and comment key).
- `mcp-server-session.md` (FR-MCP-210…260, review tools). Drift: **FR-MCP-260 is used twice**. Fix this before TG4 edits that doc.

## Task Group Sequencing

```
TG1 GitHub client ──┬── TG2 Inbox sync ── TG3 Inbox UI ─────────────┐
                    └── TG4 Review worktrees ── TG5 Review page ── TG6 Review writes ── TG7 Agent review
```

- **TG1: Server GitHub Client**: no dependencies. Everything else calls it.
- **TG2: Inbox Data & Sync**: depends on TG1.
- **TG3: Inbox UI**: depends on TG2. Until TG5 ships, the preview pane shows the PR overview only (a link-out for the files).
- **TG4: Review Worktrees**: depends on TG1 (PR head data). Can run in parallel with TG2 and TG3.
- **TG5: PR Review Page (read)**: depends on TG4.
- **TG6: Review Writes**: depends on TG5.
- **TG7: Agent Review in PR**: depends on TG6 (the comment-type split) and TG4 (worktree).

## TG1: Server GitHub Client

Replace the daemon `gh` path with a server-side client that uses `ENGY_GITHUB_TOKEN`. Move the three M11 reads to it with no change in behaviour, then delete the daemon GitHub code.

### Requirements

1. The server shall read `ENGY_GITHUB_TOKEN` from its environment at startup. When the variable is missing, every GitHub-backed surface (PRs tab, Inbox, review page) shall show one global error that says what to do: "Set `ENGY_GITHUB_TOKEN` in `.env` (dev: `.dev.env`). Create it with `gh auth token`." *(user decision 3)* (FR-TG1.1)
2. The server shall call `GET /user` once at startup and after each `401`. It shall cache the viewer login and read `X-OAuth-Scopes`. When the token is rejected, or lacks `repo` or `notifications` scope, the global error shall name the missing scope. A fine-grained PAT shall get an error that says the Notifications API does not accept fine-grained tokens. *(inferred: fail fast; Notifications API token limits)* (FR-TG1.2)
3. The system shall provide `githubRest` and `githubGraphql`, which share:
   - typed errors: `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `validation`, `network`
   - Link-header pagination
   - `If-Modified-Since` / `ETag` support
   - capture of `X-RateLimit-Remaining` / `X-RateLimit-Reset`

   When the remaining budget is below a floor, polling shall back off until the reset time. *(decision 11)* (FR-TG1.3)
4. The token shall never reach the browser, the daemon, spawned agent processes, logs or error messages. Error text shall be redacted with the M11 token patterns. *(inferred: security)* (FR-TG1.4)
5. The system shall find each workspace repo's GitHub `owner/name` from its `origin` remote URL through a daemon git op, and cache it on the server. A repo with no GitHub remote shall keep the M11 per-repo inline error. *(inferred: the server no longer runs `gh repo view`)* (FR-TG1.5)
6. The poller shall list open PRs with **two GraphQL search queries per cycle across all repos**, `is:pr is:open author:@me` and `is:pr is:open review-requested:@me`, then filter to workspace repos. It keeps every field M11 read (CI rollup, review decision, draft, head SHA, comment count). It adds `repoFullName`, `baseRefName`, `additions`, `deletions` and `reviewRequests`. *(inferred: fewer calls than M11's 2 per repo)* (FR-TG1.6)
7. Failed-check log fetch (auto-fix context) and review-comment import shall run through the client with the same truncation, redaction and idempotent ids as M11. *(M11 parity)* (FR-TG1.7)
8. The `GH_PR_LIST`, `GH_PR_FAILED_LOGS` and `GH_PR_REVIEW_COMMENTS` protocol ops, `client/src/gh/`, and their daemon handlers and server dispatchers shall be removed. *(DRY: one GitHub path)* (FR-TG1.8)

### Tasks

1. **Token config + client core**
   - Files:
     - `web/src/server/github/client.ts` [NEW], `web/src/server/github/client.test.ts` [NEW]
     - `web/src/server/github/errors.ts` [NEW]
     - `web/src/server/trpc/context.ts` [MODIFY] (viewer + rate-limit state on `AppState`)
     - `web/server.ts` [MODIFY] (startup `GET /user`)
     - `.env.example` [MODIFY]
     - `ecosystem.config.js` [MODIFY]
   - Implements FR-TG1.1…FR-TG1.4.
   - Test against a local HTTP stub (no network).
   - **Gotcha:** `pnpm start` runs PM2 under dotenv. Pass `ENGY_GITHUB_TOKEN` to `engy-web` explicitly, and make sure `engy-client` does **not** inherit it: the daemon spawns agents, and they must not see it. Check how `scripts/dev.mjs` spreads `process.env` into the client child (`:19`) and strip the variable there.
   - Verify: `pnpm blt`.
   - Type: ai. **Plan-warranted** (security boundary, env plumbing in dev and prod).

2. **Repo identity op** (depends on task 1)
   - Files: `common/src/ws/protocol.ts` [MODIFY] (`GIT_REMOTE_URL` op, or extend an existing git op; decide at plan time), `client/src/git/index.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY], `web/src/server/github/repo-identity.ts` [NEW] + test.
   - Implements FR-TG1.5.
   - Parse ssh and https remotes. Cache the result in memory, keyed by repo path.

3. **Move M11 reads to the client, delete the daemon gh module** (depends on task 2)
   - Files:
     - `web/src/server/github/prs.ts` [NEW] + test (search query, CI rollup derivation moved from `client/src/gh/index.ts:61-84`)
     - `web/src/server/pr/poller.ts` [MODIFY]
     - `web/src/server/trpc/routers/pr.ts` [MODIFY]
     - `web/src/server/pr/auto-fix.ts` [MODIFY]
     - `web/src/server/pr/review-sync.ts` [MODIFY]
     - `web/src/server/db/schema.ts` [MODIFY] (`prs.repoFullName`, `baseRef`, `additions`, `deletions`, `reviewRequests` JSON) + generated migration
     - `web/src/components/prs/pr-errors.ts` [MODIFY] (new global states)
     - `client/src/gh/` [DELETE]
     - `common/src/ws/protocol.ts`, `client/src/ws/client.ts`, `web/src/server/ws/server.ts` [MODIFY] (remove the ops)
   - Implements FR-TG1.6…FR-TG1.8.
   - Keep `upsertPrs`'s `MaterialChange` contract unchanged. TG2 consumes it.
   - Update `pr-monitoring.md` FRs that name `gh` or the daemon.
   - Verify: `pnpm blt` + playwright-cli on the PRs tab with a live token.
   - Type: ai. **Plan-warranted** (3-package removal, poller surgery).

## TG2: Inbox Data & Sync

Store Inbox items and events, fed by the GitHub Notifications API and the M11 poller.

### Requirements

1. The system shall persist Inbox items in an `inbox_items` table with one row per PR, unique on (`repoFullName`, `prNumber`). Columns: `githubThreadId` (nullable), `workspaceId` (nullable FK, `onDelete: set null`), `repoPath` (nullable), `title`, `url`, `latestReason`, `bucket` (`priority` / `other`), `unread`, `lastEventAt`, `lastReadAt`, `snoozedUntil`, `doneAt` and timestamps. *(decisions 1, 2)* (FR-TG2.1)
2. The system shall persist events in `inbox_events`: `itemId` (FK, cascade), `kind`, `actor`, `summary`, `url`, `at`, and a unique `sourceKey` so the same event is never written twice. `kind` is one of:
   - `review_requested`, `mentioned`, `commented`
   - `approved`, `changes_requested`, `reviewed`
   - `ci_failed`, `ci_passed`, `auto_fix_attention`
   - `merged`, `closed`, `reopened`, `pushed`, `assigned`

   *(decisions 6, 7)* (FR-TG2.2)
3. The system shall poll `GET /notifications?all=true&since=<last>` with `If-Modified-Since`, at the interval GitHub returns in `X-Poll-Interval` (never faster than 60 s). It shall keep only `subject.type = PullRequest` and drop the reason `ci_activity`. On first run it shall import only unread notifications. *(decision 6)* (FR-TG2.3)
4. For each updated notification thread, the system shall fetch the PR's timeline since the item's last sync with one GraphQL query, and write one event per timeline entry that is not already stored. Mention detection shall match `@<viewer>` in comment bodies. *(decision 7)* (FR-TG2.4)
5. The poller shall write `ci_failed` / `ci_passed` events from `upsertPrs` CI transitions and `auto_fix_attention` events from `attentionReason` changes. The item is created if it does not exist. This covers only PRs the poller lists: mine and review-requested. *(decision 6)* (FR-TG2.5)
6. A new event shall mark its item unread and update `lastEventAt`. It shall bring back a done item (clear `doneAt`). It shall wake a snoozed item only when the event is in the priority bucket. A snoozed item shall also wake when `snoozedUntil` passes. *(Linear behaviour)* (FR-TG2.6)
7. The bucket shall be `priority` when any of these hold, and `other` in every other case:
   - my review is requested and not yet given
   - I am mentioned
   - my PR has changes requested
   - my PR has CI failing
   - my PR has auto-fix attention
   - my PR is approved with CI passing

   The bucket is computed again on every event and on every poller cycle. *(Linear Priority tab, fixed rules)* (FR-TG2.7)
8. Mark read and mark done shall write back to GitHub (`PATCH` / `DELETE /notifications/threads/{id}`) when the item has a `githubThreadId`. A notification that GitHub reports as read shall be marked read locally. A failed write-back shall keep the local state and log once; it shall not undo the local change. *(user decision 4)* (FR-TG2.8)
9. The system shall delete items that have been done for more than 30 days, and their events. *(inferred: bounded storage)* (FR-TG2.9)
10. Every item change shall broadcast `INBOX_CHANGE` with the item id and the new unread-priority count. *(inferred)* (FR-TG2.10)

### Tasks

1. **Schema + inbox service**
   - Files: `web/src/server/db/schema.ts` [MODIFY] + generated migration, `web/src/server/inbox/store.ts` [NEW] + test (upsert item, add event with dedupe, bucket rule, wake and resurface rules, prune), `web/src/server/ws/broadcast.ts` [MODIFY], `web/src/contexts/events-context.tsx` [MODIFY].
   - Implements FR-TG2.1, FR-TG2.2, FR-TG2.6, FR-TG2.7, FR-TG2.9, FR-TG2.10.
   - Keep the bucket rule and the resurface rule as pure functions with table tests.
   - Type: ai.

2. **Notifications poller + timeline fetch** (depends on task 1)
   - Files: `web/src/server/inbox/notifications-poller.ts` [NEW] + test, `web/src/server/github/timeline.ts` [NEW] + test, `web/server.ts` [MODIFY] (start and stop).
   - Implements FR-TG2.3, FR-TG2.4.
   - Use a separate self-scheduling timer, because its interval comes from `X-Poll-Interval` and differs from the PR poller's. Keep `Last-Modified` in memory: after a restart, dedupe by `sourceKey` absorbs the full refetch.
   - Type: ai. **Plan-warranted** (timeline-to-event mapping design).

3. **Poller events + write-back** (depends on task 1)
   - Files: `web/src/server/pr/poller.ts` [MODIFY], `web/src/server/pr/auto-fix.ts` [MODIFY], `web/src/server/trpc/routers/inbox.ts` [NEW] + test (`list`, `counts`, `markRead`, `markUnread`, `markAllRead`, `markDone`, `snooze`), `web/src/server/trpc/root.ts` [MODIFY].
   - Implements FR-TG2.5, FR-TG2.8.
   - MCP parity: add `listInbox` only if an agent use case appears. Record the decision in `web/src/server/mcp/CLAUDE.md` terms.
   - Type: ai.

## TG3: Inbox UI

A global, keyboard-first Inbox page with a preview pane, a header badge and a `g i` chord.

### Requirements

1. The system shall provide a top-level `/inbox` route that works as a tab, outside any workspace. It has a list pane and a preview pane. It has the tabs **Priority** and **All**, and a workspace filter. *(decision 2; Linear Priority tab)* (FR-TG3.1)
2. Each row shall show:
   - repo and `#number`
   - PR title
   - the latest event as one line (actor + verb, e.g. "alice requested your review")
   - an unread dot
   - relative time
   - a CI pill
   - a snoozed marker when the item is snoozed

   Order: unread first, then `lastEventAt` descending. *(Linear)* (FR-TG3.2)
3. While the Inbox has focus and no text input or terminal has focus, the keys shall be:
   - `j` / `k` and the arrow keys: move
   - `Enter`: open the full review
   - `u`: toggle read
   - `Alt+u`: mark all read in the current tab
   - `e` or `Backspace`: done
   - `h`: open the snooze menu (1 hour, tomorrow 09:00, next Monday 09:00, custom)
   - `o`: open on GitHub
   - `/`: filter by title or repo
   - `?`: show the key list

   *(Linear keys; `e` matches GitHub "done")* (FR-TG3.3)
4. Selecting a row shall show the PR in the preview pane and mark it read after 1.5 s of dwell. The preview shows the event list for the item plus the PR overview (TG5's overview component once shipped; before TG5, title, body, CI and reviewers from `pr` data). *(Linear)* (FR-TG3.4)
5. The header shall show an Inbox button with the count of unread priority items. It updates live on `INBOX_CHANGE`. The `g` then `i` chord (within 1 s) shall open the Inbox from anywhere, unless a text input or terminal has focus. *(Linear `G I`)* (FR-TG3.5)
6. When a new priority event arrives and the tab is hidden, the system shall show a browser notification, if the user has granted permission. It uses the helper from task #995. *(inferred: replaces Linear email digest)* (FR-TG3.6)
7. The `PR_ATTENTION` toast shall show on every page, not only while the PRs tab is mounted. *(fixes M11 gap)* (FR-TG3.7)
8. The PRs tab in the project nav shall show a count badge: the unread priority Inbox items for the workspace's repos. It updates live on `INBOX_CHANGE`, and it is hidden at zero. In the PRs tab:
   - Each Mine / Review toggle button shall show its outstanding count next to its total. Review: my review is requested and not yet given. Mine: my PR has changes requested, CI failing, or auto-fix attention.
   - A row with an unread Inbox item shall show an unread dot.
   - Opening the review from the row shall mark the item read.

   *(user request, 2026-09-30: see outstanding work from the PRs tab)* (FR-TG3.8)

### Tasks

1. **Route + list + preview**
   - Files:
     - `web/src/app/inbox/page.tsx` [NEW]
     - `web/src/components/tabs/tab-content.tsx` [MODIFY] (top-level `/inbox` check)
     - `web/src/components/inbox/inbox-page.tsx`, `inbox-list.tsx`, `inbox-preview.tsx` [NEW]
     - `web/src/components/inbox/inbox-helpers.ts` + `.test.ts` [NEW] (row summary text, sort)
   - Implements FR-TG3.1, FR-TG3.2, FR-TG3.4.
   - Remixicon only. Use the shadcn primitives already in `components/ui/`.
   - Type: ai.

2. **Keyboard + snooze** (depends on task 1)
   - Files: `web/src/components/inbox/use-inbox-keys.ts` [NEW] + test, `web/src/components/inbox/snooze-menu.tsx` [NEW], `web/src/components/inbox/snooze-times.ts` + test [NEW].
   - Implements FR-TG3.3.
   - The focus guard must ignore events from xterm's textarea and from `input` / `textarea` / `contenteditable` elements. Check how `three-panel-layout.tsx:216` guards its keys and reuse that guard.
   - Type: ai.

3. **Header badge + `g i` chord + global attention toast** (depends on task 1)
   - Files: `web/src/components/header-actions.tsx` [MODIFY], `web/src/components/inbox/inbox-button.tsx` [NEW], a global toast listener component mounted in the root layout [NEW] (move the `PR_ATTENTION` toast out of `prs-page.tsx`).
   - Implements FR-TG3.5, FR-TG3.7.
   - Type: ai.

4. **PRs tab count + outstanding per scope** (depends on task 1)
   - Files:
     - `web/src/components/layout/header/sections.ts` [MODIFY] (optional badge source on `SectionDef`)
     - the desktop nav that renders sections, and `web/src/components/layout/mobile-header.tsx` [MODIFY]; find the desktop renderer at plan time (probably `terminal-top-bar.tsx`)
     - `web/src/server/trpc/routers/inbox.ts` [MODIFY] (`counts` by workspace)
     - `web/src/components/prs/prs-page.tsx`, `pr-list.tsx`, `pr-helpers.ts` + test [MODIFY]
   - Implements FR-TG3.8.
   - The outstanding rules must reuse the TG2 bucket function, not a copy.
   - Type: ai.

5. **Browser notification for priority events** (depends on task 3; blocked by #995)
   - Implements FR-TG3.6.
   - Type: ai. Optional. Drop this task if #995 is dropped.

Verify every task: `pnpm blt` + playwright-cli (keys, preview, badge count).

## TG4: Review Worktrees

Create a worktree when a PR is opened for review, keep it at the PR head, and remove it by itself.

### Requirements

1. When the user opens a PR for review, the system shall reuse an existing worktree on the PR's head branch if one exists (for example, a correlated agent session). If none exists, it shall:
   1. fetch `pull/<n>/head` into `refs/engy/pr/<n>` in the main checkout;
   2. create a worktree at `<workspaceDir>/worktrees/_review/<repo>/pr-<n>` on local branch `engy/review/pr-<n>`, created from that ref.

   *(user decision 5)* (FR-TG4.1)
2. The system shall record review worktrees in a `review_worktrees` table: `repoPath`, `repoFullName`, `prNumber`, `worktreePath`, `headRefName`, `headSha`, `createdByReview` (false when an agent worktree was reused), and timestamps. The table is unique on (`repoFullName`, `prNumber`). *(inferred)* (FR-TG4.2)
3. The comment key for any diff in a review worktree shall use the PR's `headRefName`, never the local `engy/review/pr-<n>` branch. So local, GitHub and agent threads for one PR share one key. `diff_review_*` MCP tools called from a session inside a review worktree shall resolve the branch through `review_worktrees` before they fall back to `dispatchGitBranch`. *(invariant: review-sync keys on `headBranch`)* (FR-TG4.3)
4. When the review page is open and `prs.headSha` differs from the worktree's `headSha`, the page shall show "New commits on GitHub" with an **Update** action. Opening a PR for review also updates an existing review worktree. Update fetches the new head. If the worktree is clean, it resets the worktree to the new head. If the worktree is dirty, it asks "This worktree has local changes." with the actions **Discard and update** and **Keep**. No background process updates worktrees. *(user decision 5: no timer logic)* (FR-TG4.4)
5. When the user opens a PR for review, the system shall remove every other review worktree it created: the worktree, its local branch and its `refs/engy/pr/<n>`. There is no timer, no poller pass and no count limit. It shall skip a worktree that:
   - has local changes; or
   - is the cwd of a live terminal or agent session.

   A skipped worktree shows in the PRs tab as "kept: local changes" or "kept: session open", with a manual **Remove** action. It is tried again on the next open. A failed removal is logged and never blocks the open. *(user decision 5, 2026-09-30)* (FR-TG4.5)
6. The cleanup shall never remove a worktree reused from an agent session (`createdByReview = false`). Only worktrees the review flow created are removed. *(inferred: safety)* (FR-TG4.6)

### Tasks

1. **Fetch refspec + reset ops**
   - Files: `common/src/ws/protocol.ts` [MODIFY] (optional `refspec` on `GIT_FETCH_REQUEST`; new `GIT_RESET_HARD` op guarded by a clean check on the daemon), `client/src/git/index.ts` [MODIFY] + test, `client/src/ws/client.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY].
   - Implements the git parts of FR-TG4.1 and FR-TG4.4.
   - Fork PRs work because `pull/<n>/head` exists on the base repo.
   - Type: ai. **Plan-warranted** (protocol change across 3 packages).

2. **Review worktree service + table** (depends on task 1)
   - Files: `web/src/server/db/schema.ts` [MODIFY] + migration, `web/src/server/review/worktrees.ts` [NEW] + test (ensure, update, and choosing which worktrees to remove as a pure function run inside `open`), `web/src/server/engy-dir/init.ts` [MODIFY] (`getReviewWorktreeDir`), `web/src/server/trpc/routers/review.ts` [NEW] (`open`, `update`, `remove`, `list`). No poller change.
   - Implements FR-TG4.1, FR-TG4.2, FR-TG4.4…FR-TG4.6.
   - Type: ai. **Plan-warranted** (lifecycle and safety rules).

3. **Comment key via review worktree** (depends on task 2)
   - Files: `web/src/server/mcp/diff-review-tools.ts` [MODIFY] + test, `web/src/lib/diff-doc-path.ts` (no change expected; confirm), `docs/system/features/mcp-server-session.md` [MODIFY] (fix the duplicate FR-MCP-260 first).
   - Implements FR-TG4.3.
   - Type: ai.

Verify: `pnpm blt` (WS tests unsandboxed).

## TG5: PR Review Page (Read)

An in-app page for one PR: overview, conversation, checks and files. It reuses the diff viewer inside the review worktree.

### Requirements

1. The system shall provide a PR review view at the workspace-level virtual path `/w/<ws>/review?repo=<owner/name>&pr=<n>&project=<slug>`, where `project` is optional and picks the review guide (FR-TG7.4). Opening it calls `review.open` (TG4) and shows progress while the worktree is created. *(inferred: query params follow the `?diffRepo` precedent)* (FR-TG5.1)
2. The header shall show:
   - title, `#number`, author, draft state, `base ← head`
   - CI pill with the check list (reuse `ChecksPopover`)
   - review decision, requested reviewers
   - additions / deletions
   - links: Open on GitHub, Open terminal here

   *(Linear)* (FR-TG5.2)
3. The **Overview** tab shall show the PR body (markdown) and the conversation: issue comments, review bodies with their verdict, and commits pushed. The data is fetched live through one GraphQL query and not persisted. *(fixes M11 gap: issue comments and review bodies were never imported)* (FR-TG5.3)
4. The **Files** tab shall show the diff `merge-base(origin/<base>, HEAD)..HEAD` of the review worktree, after a fetch of the base, with the existing file tree, split/unified toggle, stack view and viewed state. It shall show GitHub, local and agent threads on their lines. It shall show GitHub threads on files outside the diff (outdated threads) in an "Outdated" group. *(fixes `diffs-page.tsx:707-715` gap)* (FR-TG5.4)
5. The file tree shall group files as implementation, tests, docs, generated or lockfiles. The class comes from `.gitattributes` `linguist-generated` / `linguist-documentation` when set, and from path rules otherwise. Generated files and lockfiles are collapsed by default. The header line count shall show implementation lines by default, with a toggle to total. *(Linear file classes)* (FR-TG5.5)
6. Review-comment import shall run for every PR that has a review worktree or a correlated session. It shall use GraphQL `reviewThreads`, which gives `isResolved`, `isOutdated`, the thread node id, and line/side. Existing deterministic ids (`gh-thread-{firstCommentDatabaseId}`) shall be kept, so no migration of existing threads is needed. *(lifts `poller.ts:67-68` limit; prepares TG6 resolve)* (FR-TG5.6)
7. In the Files tab the keys shall be: `]` / `[` for next / previous file, `n` / `p` for next / previous unresolved thread, `v` to toggle viewed, and `Cmd/Ctrl+B` to switch split / unified. *(Linear `Cmd B`)* (FR-TG5.7)
8. PR rows in the PRs tab and the Inbox `Enter` action shall open this view. The PRs tab shall sort Review scope by "closest to shipping" (approved + passing, then approved, then passing, then the rest; ties by `updatedAt`). *(Linear Reviews list)* (FR-TG5.8)

### Tasks

1. **Extract a reusable diff surface from `diffs-page.tsx`**
   - Files: `web/src/components/diff/diff-review-surface.tsx` [NEW] (props: `repoDir`, `worktreePath`, `base`, `head`, `commentBranchKey`), `web/src/components/diff/diffs-page.tsx` [MODIFY] (uses the surface), tests.
   - No behaviour change in the Diffs tab: its FR-GIT tests must stay green unchanged.
   - Type: ai. **Plan-warranted** (991-line component refactor).

2. **Review route + header + Overview** (depends on TG4 task 2)
   - Files: `web/src/app/w/[workspace]/review/page.tsx` [NEW], `web/src/components/tabs/tab-content.tsx` [MODIFY] (`case 'review'`), `web/src/components/review/review-page.tsx`, `review-header.tsx`, `review-overview.tsx` [NEW], `web/src/server/github/pr-detail.ts` [NEW] + test, `web/src/server/trpc/routers/review.ts` [MODIFY] (`detail`).
   - Implements FR-TG5.1…FR-TG5.3.
   - Type: ai.

3. **Files tab + file classes + keys** (depends on tasks 1, 2)
   - Files: `web/src/components/review/review-files.tsx` [NEW], `web/src/components/diff/file-classes.ts` + test [NEW], `web/src/components/diff/file-tree-model.ts` [MODIFY], `web/src/components/review/use-review-keys.ts` + test [NEW].
   - Implements FR-TG5.4, FR-TG5.5, FR-TG5.7.
   - Read `.gitattributes` through the existing daemon file-read path, not a new op.
   - Type: ai.

4. **GraphQL thread import + wider sync scope**
   - Files: `web/src/server/pr/review-sync.ts` [MODIFY] + test, `web/src/server/github/review-threads.ts` [NEW] + test, `web/src/server/pr/poller.ts` [MODIFY].
   - Implements FR-TG5.6.
   - Store `githubThreadNodeId` and `isOutdated` in thread metadata.
   - Type: ai.

5. **PRs tab: open review + shipping sort** (depends on task 2)
   - Files: `web/src/components/prs/pr-list.tsx`, `pr-helpers.ts` + test [MODIFY], `web/src/components/inbox/inbox-page.tsx` [MODIFY].
   - Implements FR-TG5.8.
   - Type: ai.

Verify: `pnpm blt` + playwright-cli against a live PR from another author.

## TG6: Review Writes

Post to GitHub from the review page: drafts, replies, resolve and submit.

### Requirements

1. The inline composer on the review page shall have two buttons:
   - **Add note** creates an Engy comment (`source: 'local'`).
   - **Add to GitHub review** creates a draft (`source: 'local'`, `metadata.githubDraft: true`).

   Drafts show the GitHub badge, a "Pending" badge, and a count on the **Submit review** button. Engy comments and agent findings show a "Local only" badge. **Add to GitHub review** is enabled only on lines inside diff hunks, because GitHub rejects other lines. On expanded context lines it is disabled, with a tooltip that says why. *(decisions 8, 9)* (FR-TG6.1)
2. **Submit review** shall open a panel with a body field and a verdict (Comment / Approve / Request changes). On submit, it sends one `POST /repos/{o}/{r}/pulls/{n}/reviews` call with `commit_id = headSha`, the event, the body, and the PR's drafts as `comments[]` (`path`, `line`, `side`). The draft query selects **only** threads with `githubDraft: true`, so Engy comments and agent threads on the same diff key are never sent. Before it sends, it checks that the worktree HEAD equals the PR head SHA. If they differ, it blocks with "PR changed since you loaded it. Refresh to update." *(user decision 4)* (FR-TG6.2)
3. After a successful submit, the system shall import the PR's threads at once. It deletes a draft only after its GitHub copy is imported. It marks the Inbox item done. *(inferred: no lost comments)* (FR-TG6.3)
4. A reply on a GitHub thread shall post at once (`POST .../comments/{id}/replies`). A top-level comment in the Overview shall post at once (`POST /issues/{n}/comments`). Both show optimistically and roll back with a toast on failure. *(decision 8)* (FR-TG6.4)
5. **Resolve** / **Unresolve** on a GitHub thread shall call GraphQL `resolveReviewThread` / `unresolveReviewThread`. On `403` it shall resolve locally and show "No permission to resolve on GitHub. Resolved in Engy only." The sync shall mirror GitHub's resolved state for GitHub threads, both ways. *(decision 10)* (FR-TG6.5)
6. No code path shall create a GitHub write from an Engy comment or an agent thread. Engy comments and agent threads have no GitHub actions: no reply to GitHub, no copy to a draft, no promote. Their actions stay Send to agent, Resolve and Copy. A test posts a review for a diff key that holds all three types, and asserts that only the drafts reach the GitHub client. *(user decision, 2026-09-30; decision 9)* (FR-TG6.6)
7. On GitHub threads of the viewer's own PR, "Fix Selected" (M11) keeps working. "Dismiss" becomes Resolve per FR-TG6.5. *(M11 parity)* (FR-TG6.7)

### Tasks

1. **Drafts + submit review**
   - Files: `web/src/server/github/reviews.ts` [NEW] + test, `web/src/server/trpc/routers/review.ts` [MODIFY] (`createDraft`, `submit`), `web/src/components/review/submit-review-panel.tsx` [NEW], `web/src/components/diff/comment-widget.tsx` [MODIFY] (pending badge), `web/src/components/diff/review-drafts.ts` + test [NEW] (draft → `comments[]` mapping, hunk check).
   - Implements FR-TG6.1…FR-TG6.3.
   - Type: ai. **Plan-warranted** (line/side mapping must match GitHub's diff exactly; write tests from a recorded PR fixture).

2. **Replies, top-level comments, resolve** (depends on task 1)
   - Files: `web/src/server/github/reviews.ts` [MODIFY], `web/src/server/trpc/routers/review.ts` [MODIFY], `web/src/components/diff/comment-widget.tsx` [MODIFY] (GitHub threads get reply and resolve; M11 made them read-only), `web/src/components/review/review-overview.tsx` [MODIFY], `web/src/server/pr/review-sync.ts` [MODIFY] (two-way resolved state), `web/src/components/diff/github-comment-triage.tsx` [MODIFY].
   - Implements FR-TG6.4, FR-TG6.5, FR-TG6.7.
   - Type: ai.

3. **Comment-type separation guard** (depends on task 1)
   - Files: `web/src/components/diff/comment-widget.tsx` [MODIFY] (composer with two buttons; "Local only" badge; no GitHub actions on Engy or agent threads; find the new-comment composer at plan time, in `comment-widget.tsx` or the react-diff-view widget code), `web/src/server/trpc/routers/review.ts` [MODIFY] (`submit` filters on `githubDraft`), tests.
   - Implements FR-TG6.6 and the composer part of FR-TG6.1.
   - Type: ai.

Verify: `pnpm blt` + playwright-cli against a throwaway PR in a test repo (submit Comment, reply, resolve, unresolve on github.com, then check the mirror).

## TG7: Agent Review in PR

Run the existing agent review on a PR from the review page, and give the result a reading order and a risk level. A default review guide controls what the overview and the review contain. Each Engy project can override it with a `review-guide.md` in its project dir.

### Requirements

1. The review page shall have **Review with agent**. It spawns a terminal session in the review worktree that runs `/engy:review-diff` with the scope `merge-base..HEAD` (reuse `buildReviewPrompt`, `review-dispatch.ts`). Findings appear as agent threads through the existing `diff_review_*` tools, keyed per FR-TG4.3. Agent findings stay Engy comments and never reach GitHub (FR-TG6.6). The review prompt tells the agent to use only `diff_review_*` tools, and never `gh` or the GitHub API, to write findings. *(existing flow, new host; user decision on separation)* (FR-TG7.1)
2. `diff_review_summary` shall accept an optional `risk` (`low` / `typical` / `high` / `very_high`) with a one-line reason, and an optional `readingOrder` (a list of `{ title, files[], note }`). The review-summary panel shall render the risk badge and the reading order, and clicking a file in the reading order shall scroll the diff to it. The review-diff skill shall be updated to produce both. What the overview says, and how risk is judged, come from the review guide (FR-TG7.4). *(Linear risk score + Guided Review, reduced)* (FR-TG7.2)
3. A workspace setting `autoReviewOnRequest` (default off) shall start an agent review when a `review_requested` event arrives for a repo in that workspace. It is gated by daemon readiness and `maxConcurrency` (the `triggerAutoStart` gates), and runs at most once per (PR, head SHA). It creates the review worktree through `review.open`, so the FR-TG4.5 cleanup runs as usual: the live-session guard protects worktrees whose agent review is still running. The risk level shall show on the Inbox row once the review is done. Findings stay local, per FR-TG6.6. *(inferred: findings are ready when the user opens the PR)* (FR-TG7.3)
4. Every agent review (PR review page, auto review, and the Diffs tab "Review diff") shall follow a **review guide**. The guide is a markdown file with two sections:
   - `## Overview`: what the generated summary must contain, how to build the reading order, and how to judge risk.
   - `## Review`: what to look for, what to ignore, and the project's rules.

   Resolution rules:
   - **Default:** the guide ships with the skill at `plugins/engy/skills/review-diff/references/review-guide.md`.
   - **Override per Engy project:** an Engy project overrides the default with `review-guide.md` in its project dir, the folder that holds `spec.md` and `milestones/` (for example `docs/projects/initial/review-guide.md`). Repos never carry Engy review config.
   - **Per section:** each section in the project file replaces the same section of the default. A section the project file leaves out falls back to the default. There is no merging inside a section.
   - **Which project:**
     - The Diffs tab uses its own project.
     - The review page carries a `project` route param (FR-TG5.1). Opening a review from a project's PRs tab sets it to that project. Opening it from the Inbox sets it to the project of the correlated agent session, if there is one.
     - With no project, the review uses the default guide, and the review page header shows a project picker. Auto review (FR-TG7.3) uses the correlated session's project, else the default.
   - **Hand-off:** the server resolves the project dir and puts `reviewGuide: <absolute path>` in the review prompt only when the file exists. The skill reads that file and falls back to its default per section. The file lives in Engy's project docs, never in the PR, so a PR cannot change the guide that reviews it.
   - **Shown in panel:** `diff_review_summary` takes a `guide` field (`default` / `project`). The summary panel shows "Guide: default" or "Guide: <project>/review-guide.md". The panel offers two actions:
     - With the default guide, **Customize for this project** creates `review-guide.md` in the project dir, filled with the default text, and opens it in the Docs tab.
     - With a project guide, **Edit guide** opens the project's file in the Docs tab.

   *(user request, 2026-09-30: easy customisation per Engy project)* (FR-TG7.4)

### Tasks

1. **Review with agent on the review page**
   - Files: `web/src/components/review/review-page.tsx` [MODIFY], `web/src/components/diff/review-dispatch.ts` [MODIFY] (worktree-aware scope).
   - Implements FR-TG7.1.
   - Type: ai.

2. **Risk + reading order**
   - Files: `web/src/server/mcp/diff-review-tools.ts` [MODIFY] + test, `web/src/components/diff/review-summary-panel.tsx` [MODIFY], `plugins/engy/skills/review-diff/SKILL.md` [MODIFY], `docs/system/features/mcp-server-session.md` [MODIFY].
   - Implements FR-TG7.2.
   - Type: ai.

3. **Review guide: default + project override** (depends on task 2)
   - Files:
     - `plugins/engy/skills/review-diff/references/review-guide.md` [NEW]: the default. Move the overview and review instructions that are inline in `SKILL.md` today into it.
     - `plugins/engy/skills/review-diff/SKILL.md` [MODIFY]: an optional `reviewGuide` input, a "load guide" step before review, and per-section fallback.
     - `web/src/components/diff/review-dispatch.ts` [MODIFY]: add `reviewGuide` to `buildReviewPrompt`.
     - `web/src/server/trpc/routers/review.ts` [MODIFY] + test: a `guide` query that returns the project guide path, or null, and the default text. It resolves the project dir the same way `getProjectDetails` does.
     - `web/src/server/mcp/diff-review-tools.ts` [MODIFY] + test: the `guide` field.
     - `web/src/components/diff/review-summary-panel.tsx` [MODIFY]: the guide label, plus **Customize for this project** / **Edit guide** through the existing project docs write path and a Docs tab link.
     - `web/src/components/review/review-header.tsx` [MODIFY]: the project picker when no project is set.
   - Implements FR-TG7.4.
   - Test the per-section fallback with a fixture project guide that holds only `## Review`.
   - Type: ai.

4. **Auto review on request** (depends on tasks 1, 3)
   - Files: `web/src/server/review/auto-review.ts` [NEW] + test, `web/src/server/db/schema.ts` [MODIFY] (`workspaces.autoReviewOnRequest`, a `review_worktrees.autoReviewedSha` column) + migration, workspace settings UI [MODIFY], `web/src/components/inbox/inbox-list.tsx` [MODIFY] (risk badge).
   - Implements FR-TG7.3.
   - Type: ai. **Plan-warranted** (automated dispatch; copy the `maybeDispatchCiFix` gate order).

Verify: `pnpm blt` + playwright-cli.

## Feature Docs Impact

- `pr-monitoring.md`:
  - Rewrite FRs that name `gh` / the daemon (TG1).
  - Change FR-PRMON-160/170 to the resolved-state and resolve rules (TG6).
  - Rewrite "Out of scope" (GitHub writes and the notification center are now in scope).
- New areas `pr-inbox` and `pr-review`: author them through `/engy:feature-docs`, not by hand.
- `git-and-worktree.md`: diff surface extraction (no FR change expected) and the review worktree comment-key rule.
- `mcp-server-session.md`:
  - Fix the duplicate FR-MCP-260 before other edits.
  - Branch resolution through review worktrees (TG4).
  - The `risk` / `readingOrder` args (TG7).
- Run `engy:reindex` (collection `system`) after each doc edit.

## Out of Scope

- Merge, auto-merge, merge queue (user decision 4)
- Webhooks (polling only)
- GitHub Enterprise or more than one GitHub host. One `ENGY_GITHUB_TOKEN` means github.com only.
- Agent and Engy-internal events in the Inbox (user decision 1)
- Sync of GitHub pending reviews created on github.com, and of GitHub's per-file "viewed" flag
- Structural (syntax-aware) diff highlighting
- Stacked-PR tooling
- Custom Priority filters (fixed rules only)
- Email or Slack delivery
- Relocating threads after a force-push moves lines (M11 known gap, unchanged; `isOutdated` from GraphQL at least marks them)

## Open Questions

- **M12 overlap.** M12 plans a header "needs me" attention popover next to the question badge. With a PR-only Inbox, the header would have three attention surfaces: questions, needs-me and Inbox. Decide before M12 TG1 whether the Inbox takes other subject kinds (the table key would become `subjectKind` + `subjectKey`) or whether the surfaces stay separate.
- **Repos in several workspaces.** A global item maps to the first workspace that owns the repo. Should the review view let the user pick, or is first-match fine?
- **Mention detection.** GitHub reports `mention` as the notification reason, but the timeline may hold several comments. FR-TG2.4 matches `@<viewer>` in bodies. Team mentions (`team_mention`) are kept as a reason-only event with no body match.
