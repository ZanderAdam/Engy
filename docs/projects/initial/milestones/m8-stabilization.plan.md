---
title: Stabilization — Bug Fixes
status: draft
---

# Plan: M8 Stabilization — Bug Fixes

## Overview

This milestone fixes the bugs surfaced by two hunts on 2026-06-11: a full-codebase adversarial static hunt (67 raw findings, 46 confirmed after verification, 20 refuted — TG1–TG9) and a live exploratory playwright-cli hunt against the running app (TG10–TG11). The bugs span the execution engine (session lifecycle, event delivery, compensating actions), terminal PTY lifecycle (expiry, reconnect races), the knowledge/search layer (docsDir resolution, filter leaks, cross-workspace scoping), plan/project file safety (overwrites, path-guard bypasses, frontmatter corruption), web UI state (stale closures, discarded auto-saves, zombie reconnects), error surfacing (server 500s rendered as empty states), and visible UI defects (editor layout collapse, broken milestone panel). Every task fixes specific, verified defects — static findings carry the verifier's confirmed trigger; live findings carry browser repro steps.

Note: the spec's §6.1 currently lists M8 as "Workspace Polish". This plan takes the m8 slot per explicit decision; Workspace Polish moves to a later slot when planned.

Boundary: no new features, no refactors beyond what a fix requires, no protocol redesign (the WS message catalog stays as-is; only payload handling/sequencing changes), no fixes for the 20 refuted findings.

## Codebase Context

- **`client/src/runner/`** — `Runner` (index.ts) orchestrates agent execution per `EXECUTION_START_REQUEST`; `AgentSpawner` (agent-spawner.ts) spawns the claude CLI. Both hold single-slot state (`currentProcess`, `currentSessionId`, `currentWorktreePath`) wired once in `WsClient`'s constructor.
- **`client/src/ws/client.ts`** — `WsClient` owns the main + terminal-relay sockets, `send()`, `startPing()`, reconnect/backoff, and all request handlers.
- **`client/src/terminal/`** — `TerminalManager` (manager.ts) owns PTYs keyed by sessionId; `SessionManager` (session-manager.ts) owns the suspended-session expiry timer.
- **`web/src/server/ws/`** — `server.ts` handles daemon registration + execution events (`handleExecutionStatusEvent`, `handleExecutionCompleteEvent`); `terminal-server.ts` relays browser↔daemon terminal traffic with `pendingReconnects` and `terminalSessionMeta` maps.
- **`web/src/server/trpc/routers/`** — routers follow a compensating-action pattern (insert → dispatch → catch reverts + broadcasts; see `retryExecution`/`sendFeedback` in execution.ts for the canonical resume pattern with `buildResumeConfig`). The routers CLAUDE.md mandates a broadcast after every state-changing mutation.
- **`web/src/server/search/`** — qmd hybrid search: `qmd-store.ts` (store singleton), `indexer.ts` (frontmatter table + permanent-memory mirror + `forceFullReindex`), `auto-linker.ts`, `validate.ts`.
- **`web/src/server/plan/service.ts` + `project/service.ts`** — line-based frontmatter parse/serialize for milestone plan files; `validatePath` for project file ops; `initProjectDir`.
- **`web/src/components/terminal/`** — dockview-based `terminal-manager.tsx` broadcasting a `window.__engy_terminal_active` global + tabId-filtered CustomEvents, consumed by `use-terminal-active.ts`.
- Shipped in prior milestones: M6 execution engine (worktrees, state machine), M7 knowledge layer (qmd, memory mirror, validate/reindex). M9 (async agents) is already planned separately and may rework parts of the execution engine — M8 fixes the current implementation; coordinate before starting M9.

Full bug-hunt report with verifier evidence: workflow run `wf_4f0b2b48-9e0` (2026-06-11).

## Task Group Sequencing

- **TG1: Execution session integrity (client daemon)** — no dependencies. Can start immediately.
- **TG2: Terminal session lifecycle (client + relay)** — no dependencies. Can start immediately (parallel with TG1; no shared files).
- **TG3: Server execution & question router compensation** — no dependencies (web-side only). Parallel with TG1/TG2.
- **TG4: Knowledge & search correctness** — no dependencies.
- **TG5: Project, milestone & plan file safety** — no dependencies.
- **TG6: Client daemon misc** — depends on TG1 (`runner/index.ts`) and TG2 (`client/src/index.ts`) — shared files, serialized to avoid conflicts.
- **TG7: Editor & comments** — no dependencies.
- **TG8: Terminal-active state (web UI)** — no dependencies.
- **TG9: Web UI data-loss & race fixes** — no dependencies.
- **TG10: Error surfacing & data integrity (live hunt)** — task 5 depends on TG3 (`routers/workspace.ts`); rest independent.
- **TG11: UI defects (live hunt)** — task 1 should land after TG7 task 1 (both touch comment anchoring/editor surfaces, different files but same review surface); rest independent.

TG1–TG3 carry the highest-severity backend bugs — prioritize them alongside TG10 task 1 (migration desync) and TG11 task 1 (editor collapse). Note: TG1 task 2 (duplicate-complete suppression) and TG3 task 3 (server-side idempotency) are complementary defense-in-depth fixes for the same failure class; they can land in either order.

## TG1: Execution Session Integrity (client daemon)

The client daemon's execution path assumes exactly one session at a time and a permanently-open socket. Both assumptions are false (workspace `maxConcurrency` is configurable; the server restarts). This group makes the runner session-scoped and event delivery reliable.

### Requirements

1. The daemon shall track each agent process keyed by sessionId, so concurrent sessions never corrupt each other's process handles. *(source: user request)* (FR-TG1.1)
2. The daemon shall stop exactly the session named in `EXECUTION_STOP_REQUEST`, not the most recently started one. *(source: user request)* (FR-TG1.2)
3. When a session is stopped via `Runner.stop()`, the daemon shall emit exactly one `EXECUTION_COMPLETE_EVENT` for that session. *(source: user request)* (FR-TG1.3)
4. When the main WS is not OPEN, the daemon shall queue outgoing execution events and flush them after reconnect, so completion events are never silently lost. *(source: user request)* (FR-TG1.4)
5. The daemon shall detect half-open WS connections via pong deadlines and force reconnection, on both the main and terminal-relay sockets. *(source: user request)* (FR-TG1.5)

### Tasks

1. **Session-scoped process tracking in Runner and AgentSpawner**
   - Files: `client/src/runner/agent-spawner.ts` [MODIFY], `client/src/runner/index.ts` [MODIFY], `client/src/ws/client.ts` [MODIFY], `client/src/runner/index.test.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.2
   - **Bug (high, race-condition):** `AgentSpawner` keeps a single `currentProcess` slot and `Runner.start()` has no busy guard, while the server's duplicate-session guard in `startExecution` is per task/taskGroup — so two sessions on different tasks both dispatch to the one Runner. Session B's spawn overwrites `currentProcess`, orphaning A's handle; A's exit then nulls B's handle (unkillable). `Runner.stop()` kills whichever process is current and stamps its synthetic complete with `currentSessionId` (last started), so stopping A can kill and mark-stopped B. `currentWorktreePath`/`currentConfig` are similarly clobbered. The `EXECUTION_STOP_REQUEST` handler in `WsClient` also ignores the request's `sessionId`.
   - **Fix:** replace single-slot fields with a `Map<sessionId, {proc, worktreePath, config}>` in both classes; `stop(sessionId)` targets the named session; the `WsClient` stop handler passes the request's sessionId through. Per-session completion handling reads from the map entry, not shared fields.
   - **Acceptance:** test spawning two concurrent fake sessions — stopping session A kills only A's process and emits a complete event carrying A's sessionId; B's completion still fires with B's data. `cd client && pnpm vitest run src/runner/index.test.ts` passes.

2. **Suppress duplicate completion after stop()** (depends on task 1)
   - Files: `client/src/runner/index.ts` [MODIFY], `client/src/runner/index.test.ts` [MODIFY]
   - Implements FR-TG1.3
   - **Bug (medium, state-bug):** `Runner.stop()` emits a synthetic complete event (exitCode 1, success false) immediately, but nothing suppresses the real one: when the SIGTERM'd process closes, the spawn promise's `.then` calls `handleCompletion`, emitting a second `EXECUTION_COMPLETE_EVENT` (and potentially a `CREATE_MEMORIES_REQUEST`) for the same session. The server processes both; in the race where the dying process flushes structured output with `taskCompleted: true`, the user-stopped task flips to done and the auto worktree merge dispatches despite the explicit stop.
   - **Fix:** mark the session's map entry as `stopped` in `stop()`; `handleCompletion` returns early for stopped sessions (or: drop the synthetic event and let the real close emit a stop-flavored completion — implementer's call, but exactly one event must fire and it must report success=false for a user stop).
   - **Acceptance:** test that stop() followed by process close emits exactly one complete event with success=false and no `CREATE_MEMORIES_REQUEST`.

3. **Queue execution events while disconnected, flush on reconnect**
   - Files: `client/src/ws/client.ts` [MODIFY], `client/src/ws/client.test.ts` [MODIFY]
   - Implements FR-TG1.4
   - **Bug (high, state-bug):** `WsClient.send()` is a silent no-op unless `ws.readyState === OPEN`, with no queue and no post-reconnect reconcile (the reconnect handler sends only `REGISTER`). Agents run up to 30 minutes; if the server is restarting or the socket is in backoff when the agent finishes, `EXECUTION_COMPLETE_EVENT` is permanently lost — the server never moves the 'active' session to completed and the task is stuck running forever; completion memories are also lost.
   - **Fix:** add a bounded outbox in `WsClient` for execution-critical messages (`EXECUTION_STATUS_EVENT`, `EXECUTION_COMPLETE_EVENT`, `CREATE_MEMORIES_REQUEST`): when the socket is not OPEN, enqueue; after reconnect + REGISTER, flush in order. Cap the queue (e.g. last N messages) to bound memory; non-critical message types keep current drop behavior.
   - **Acceptance:** test that a complete event emitted while the socket is closed is delivered after the socket reopens, in order, exactly once.

4. **Pong-deadline liveness for both sockets** (depends on task 3)
   - Files: `client/src/ws/client.ts` [MODIFY], `client/src/ws/client.test.ts` [MODIFY]
   - Implements FR-TG1.5
   - **Bug (medium, liveness):** `startPing()` sends `ws.ping()` every 30s but registers no `pong` listener or deadline, so a half-open connection (laptop sleep, Wi-Fi switch, NAT timeout) keeps `readyState` OPEN until the OS TCP retransmit timeout (~15 min). During that window the daemon reports healthy, `scheduleReconnect` never runs, and all server requests fail.
   - **Fix:** track last-pong timestamp per socket; if no pong within a deadline (e.g. 2 missed intervals), `ws.terminate()` so the close handler triggers the existing reconnect path. Apply to both the main and terminal-relay sockets.
   - **Acceptance:** test that a socket whose pongs stop is terminated and reconnection is scheduled.

**Parallelizable:** Tasks 1 and 3 have no shared files and can run concurrently; 2 follows 1, 4 follows 3.

### Completion Summary

## TG2: Terminal Session Lifecycle (client + relay)

Suspended PTYs currently never expire, stale PTY exits can destroy live replacement sessions, and two relay-side races lose session metadata or scrollback. This group makes the PTY lifecycle correct end to end.

### Requirements

1. The daemon shall run the suspended-session expiry timer for its entire lifetime, so suspended PTYs are killed after the 5-minute window and `{t:'exit', exitCode:-1}` is reported. *(source: user request)* (FR-TG2.1)
2. PTY exit and kill handling shall only remove a session from the registry if the exiting PTY is still the registered instance for that sessionId. *(source: user request)* (FR-TG2.2)
3. A browser reconnect arriving while the relay daemon is briefly disconnected shall not destroy server-side session metadata for a live PTY. *(source: user request)* (FR-TG2.3)
4. Concurrent browser reconnects to the same session shall each receive the scrollback buffer reply. *(source: user request)* (FR-TG2.4)

### Tasks

1. **Start (and stop) the SessionManager cleanup timer**
   - Files: `client/src/index.ts` [MODIFY], `client/src/terminal/session-manager.ts` [MODIFY], `client/src/terminal/session-manager.test.ts` [MODIFY]
   - Implements FR-TG2.1
   - **Bug (high, resource-leak):** `SessionManager.start()` is the only place the cleanup interval is created, and nothing ever calls it — `main()` in client/src/index.ts constructs `new SessionManager()` and `TerminalManager`'s constructor only wires `setExpireCallback`. The 5-minute suspended-session expiry is dead code: after a permanent relay disconnect (e.g. server gone), every suspended PTY (shells, claude CLI, ssh) leaks until daemon shutdown and the documented `{t:'exit', exitCode:-1}` is never sent — contradicting `client/src/terminal/CLAUDE.md`.
   - **Fix:** call `sessionManager.start()` during daemon startup in `main()`; clear the interval in the shutdown path. Consider unref'ing the timer so it doesn't hold the process open.
   - **Acceptance:** test (fake timers) that a suspended session older than the expiry window is killed and the expire callback fires after daemon start.

2. **Identity guards on PTY exit/kill/spawn**
   - Files: `client/src/terminal/manager.ts` [MODIFY], `client/src/terminal/manager.test.ts` [MODIFY]
   - Implements FR-TG2.2
   - **Bug (medium, race-condition):** `kill()` removes the session from the map immediately but the PTY survives up to the 3s SIGTERM grace. If the server respawns a session reusing the same sessionId in that window, `spawnPty()` overwrites the map entry without killing any existing PTY, and the old PTY's `onExit` unconditionally runs `sessions.delete(sessionId)` and sends `{t:'exit'}` — deleting the live replacement and telling the server the new terminal died. Verified trigger: kill in one of two attached browser windows → the other window's reconnect respawns the id while a SIGTERM-ignoring shell lingers.
   - **Fix:** in `onExit` and the kill path, verify `this.sessions.get(sessionId) === session` before deleting/notifying; in `spawnPty`, kill any existing PTY for the id before overwriting the entry.
   - **Acceptance:** test that a stale PTY exit after respawn neither removes the new session nor emits an exit for it.

3. **Relay reconnect races: retain meta, per-socket pending replies**
   - Files: `web/src/server/ws/terminal-server.ts` [MODIFY], `web/src/server/ws/terminal-server.test.ts` [MODIFY]
   - Implements FR-TG2.3, FR-TG2.4
   - **Bug A (medium, state-bug):** the browser-reconnect path, when `state.terminalDaemon` is momentarily null (relay socket reconnecting, 1–30s backoff), deletes `state.terminalSessionMeta` for the session and errors out — defeating the relay close handler, which deliberately retains meta so the next daemon sync can reattach. A page refresh during the relay-down window permanently orphans a live PTY (the sync handler iterates server-side meta only).
   - **Bug B (low, race-condition):** `pendingReconnects` is a single-slot map per sessionId; two tabs reconnecting before the daemon replies means the second `set` clobbers the first — the first tab never gets its `reconnected` scrollback reply and shows a blank terminal, and the daemon's second reply is dropped.
   - **Fix:** (A) when the relay daemon is null, keep meta and return a retryable error (or park the reconnect until the daemon syncs). (B) make `pendingReconnects` hold a set/array of waiting sockets per sessionId and deliver the buffer reply to all of them.
   - **Acceptance:** existing meta-retention test still passes; new tests: reconnect-during-relay-down leaves meta intact; two concurrent reconnects both receive the `reconnected` buffer payload.

**Parallelizable:** All three tasks touch disjoint files and can run concurrently.

### Completion Summary

## TG3: Server Execution & Question Router Compensation

The web server's execution paths violate their own compensating-action discipline in several places: validation after writes, rollbacks without broadcasts, a resume path missing its config, out-of-enum status writes, and swallowed post-completion failures.

### Requirements

1. `startExecution` shall validate all preconditions (including remote-with-no-repos) before inserting the session row or updating the task. *(source: user request)* (FR-TG3.1)
2. Every execution-start failure rollback shall broadcast the reverted task state (`startExecution`, `startBatchExecution`, `triggerAutoStart`). *(source: user request)* (FR-TG3.2)
3. `question.submitAnswers` shall resume using the same mechanism as `retryExecution`/`sendFeedback`: resume config pointing at the original worktree, reusing the original session row. *(source: user request)* (FR-TG3.3)
4. `question.submitAnswers` shall apply a compensating action and broadcast when the resume dispatch fails. *(source: user request)* (FR-TG3.4)
5. The server shall only write schema-enum values into `tasks.subStatus` when handling daemon status events. *(source: user request)* (FR-TG3.5)
6. `handleExecutionCompleteEvent` shall be idempotent per session and shall surface auto-merge / coder plan-pull failures to the task state instead of only logging. *(source: user request)* (FR-TG3.6)
7. `workspace.update` failure handling shall leave DB, `workspace.yaml`, and the daemon's workspace sync consistent. *(source: user request)* (FR-TG3.7)

### Tasks

1. **startExecution validation ordering + rollback broadcasts**
   - Files: `web/src/server/trpc/routers/execution.ts` [MODIFY], `web/src/server/trpc/routers/execution.test.ts` [MODIFY]
   - Implements FR-TG3.1, FR-TG3.2
   - **Bug A (high, error-handling):** the `remote && !repos[0]` BAD_REQUEST throw in `startExecution` happens after the agentSessions insert (status 'active') and the task's in_progress update + broadcast, but before the try/catch holding the compensating rollback. Result: an orphaned active session trips the duplicate-session CONFLICT guard for 24h and the task is stuck in_progress with no agent. The existing test for remote-with-no-repos asserts only the error message, not cleanup.
   - **Bug B (low, state-bug):** the catch blocks that revert task status with subStatus 'failed' in `startExecution`, `startBatchExecution`, and `triggerAutoStart` never call `broadcastTaskChange`, while the in_progress transition does broadcast — browsers show a phantom running task (staleTime 30s, no refetch-on-focus; the violated rule is written in the routers CLAUDE.md).
   - **Fix:** hoist all input/precondition validation above the first write; add `broadcastTaskChange` to all three rollback paths.
   - **Acceptance:** tests assert remote-with-no-repos leaves zero session rows and the task unchanged; a forced dispatch failure produces both the revert and a TASK_CHANGE broadcast.

2. **submitAnswers resume parity + compensation** (depends on task 1 — shares execution.ts helpers)
   - Files: `web/src/server/trpc/routers/question.ts` [MODIFY], `web/src/server/trpc/routers/execution.ts` [MODIFY if buildResumeConfig needs exporting], `web/src/server/trpc/routers/question.test.ts` [MODIFY]
   - Implements FR-TG3.3, FR-TG3.4
   - **Bug A (high, logic-error):** `submitAnswers` calls `dispatchExecutionStart` with `['--resume', ...]` but no `ExecutionStartConfig` — the daemon defaults repoPath to `''` and takes the local-mode branch, creating a brand-new worktree (or failing on `simpleGit('')`) instead of reusing the original session's worktree, where `claude --resume` must run. It also inserts a NEW agentSessions row even though the spawner skips `--session-id` under `--resume`, so the transcript appends to the old session's JSONL and the UI polls an empty file forever — the exact failure mode the comment in `retryExecution` warns about, and which `retryExecution`/`sendFeedback` fixed with `buildResumeConfig` + original-row reuse.
   - **Bug B (medium, error-handling):** the active-session insert precedes an unguarded `await dispatchExecutionStart`; on daemon failure the orphan row blocks `startExecution`'s duplicate guard for 24h, the `'answered'` broadcast never fires, and re-submitting is impossible (answers already persisted → "expected 0 answers").
   - **Fix:** mirror the `sendFeedback` pattern: `buildResumeConfig` with the original session's worktree path, reuse/update the original session row instead of inserting a new one, wrap the dispatch in try/catch with a compensating 'stopped' update, and broadcast question + task changes on both success and failure paths.
   - **Acceptance:** tests assert the dispatched payload carries the original worktree config; a failed dispatch leaves no orphaned active row and still broadcasts the answered state.

3. **Completion/status handler hardening in ws server**
   - Files: `web/src/server/ws/server.ts` [MODIFY], `web/src/server/ws/server.test.ts` [MODIFY]
   - Implements FR-TG3.5, FR-TG3.6
   - **Bug A (medium, state-bug):** `handleExecutionStatusEvent` casts the daemon's status straight into `tasks.subStatus`. The Runner only ever emits `'running'`, which is outside the enum (`planning|implementing|blocked|failed|plan_review`) and SQLite has no CHECK — clobbering the `'implementing'`/`'planning'` value `startExecution` just set and breaking literal comparisons like milestone-list's active-task detection for the whole run.
   - **Bug B (low, error-handling):** `handleExecutionCompleteEvent` marks the task done inside the transaction, then fire-and-forgets `dispatchWorktreeMerge` whose `.catch` only console.errors — a merge conflict/daemon drop/timeout leaves work unmerged in an orphan worktree while the task shows done, with the completed session hidden from `getWorktreeSessions`. Same pattern for the coder plan-file pull: task moves to plan_review even when the pull failed.
   - **Bug C (defense-in-depth for TG1 task 2):** the handler has no per-session idempotency guard, so duplicate complete events re-run the completion transaction and re-broadcast.
   - **Fix:** validate/map incoming status against the subStatus enum (drop or translate `'running'`); guard `handleExecutionCompleteEvent` against sessions already in a terminal status; on merge/plan-pull failure update subStatus to 'failed' (or a dedicated marker) and broadcast so the UI surfaces it.
   - **Acceptance:** tests: a `'running'` status event does not overwrite subStatus; a second complete event for the same session is a no-op; a failed merge dispatch results in a broadcast task update, not silence.

4. **workspace.update rollback completeness**
   - Files: `web/src/server/trpc/routers/workspace.ts` [MODIFY], `web/src/server/trpc/routers/workspace.test.ts` [MODIFY]
   - Implements FR-TG3.7
   - **Bug (low, state-bug):** when `renameWorkspaceDir` throws mid-update, the catch restores only the slug column and rethrows — all other fields written by the same `db.update` (name, repos, docsDir, container config) stay committed while the caller sees an error, and the path skips both `writeWorkspaceYaml` and `broadcastWorkspacesSync`, leaving yaml stale and the daemon holding the old repos list. Trigger: the edit dialog always sends the full field set, and rename fails when the target dir exists on disk (orphaned dirs survive workspace.delete).
   - **Fix:** capture the full previous row and restore all updated fields in the catch (or perform the dir rename before the DB write); on either outcome, re-sync yaml + broadcast so daemon state matches the DB.
   - **Acceptance:** test that a failed rename leaves every column at its prior value and the daemon receives a consistent WORKSPACES_SYNC.

**Parallelizable:** Tasks 1, 3, 4 are disjoint; task 2 follows task 1.

### Completion Summary

## TG4: Knowledge & Search Correctness

The search stack has one systemic defect (docsDir ignored) plus filter leaks duplicated across tRPC and MCP, scoping and reindex bugs, and a path-walk that writes outside the workspace.

### Requirements

1. The qmd store shall resolve collection paths using the workspace's actual `docsDir`. *(source: user request)* (FR-TG4.1)
2. `forceFullReindex` shall preserve collection context descriptions and actually reindex from scratch. *(source: user request)* (FR-TG4.2)
3. All permanent-memory row lookups shall be scoped by workspaceId. *(source: user request)* (FR-TG4.3)
4. Workspace validation shall not flag system-seeded README.md files. *(source: user request)* (FR-TG4.4)
5. A search with only a `status` filter shall not return non-task frontmatter documents, in both the tRPC and MCP search paths. *(source: user request)* (FR-TG4.5)
6. README index regeneration shall never write outside the workspace directory, and every README it writes shall be included in the commit set. *(source: user request)* (FR-TG4.6)

### Tasks

1. **docsDir-aware qmd store**
   - Files: `web/src/server/search/qmd-store.ts` [MODIFY], `web/src/server/search/qmd-store.test.ts` [MODIFY]
   - Implements FR-TG4.1
   - **Bug (high, state-bug):** `getStore()` builds the workspace dir with `getWorkspaceDir({ slug, docsDir: null })`, always resolving to `{ENGY_DIR}/{slug}`, while every other search component honors the workspace's custom `docsDir`. For opened-directory workspaces the qmd collections point at a directory that was never created — hybrid/lex/vector search and the auto-linker similarity pass silently return nothing. `forceFullReindex` re-adds collections at the *correct* docsDir-aware path, and qmd's config-hash gate then makes the store flip between two paths depending on whether a force reindex ever ran.
   - **Fix:** thread the full workspace row (or its docsDir) into `getStore()` and use `getWorkspaceDir(ws)` everywhere a collection path is built, keeping it consistent with `indexer.ts`.
   - **Acceptance:** test with a workspace whose docsDir differs from the default: collections register under docsDir and a seeded file is searchable.

2. **forceFullReindex preserves context and reindexes fully**
   - Files: `web/src/server/search/indexer.ts` [MODIFY], `web/src/server/search/indexer.test.ts` [MODIFY]
   - Implements FR-TG4.2
   - **Bug (medium, state-bug):** `forceFullReindex` calls `store.addCollection(col, { path, pattern })` without the `context` key that `getStore`'s create config sets; qmd's upsert overwrites context with NULL, and on restart the config-hash gate skips re-sync — one `/engy:reindex` permanently wipes the relevance-steering descriptions. Also, `removeCollection` deletes only the registration row, not documents, so unchanged files re-hash as 'unchanged' and the reindex isn't actually from scratch.
   - **Fix:** pass the same context map used at store creation when re-adding collections; delete the collection's documents (or use whatever purge API qmd exposes) before re-adding so a full reindex is genuinely full. If qmd's API can't express either, document the limitation and force a config-hash invalidation instead.
   - **Acceptance:** test that after `forceFullReindex` the collection rows still carry their context and previously-indexed unchanged files are re-embedded (or the chosen purge semantics are pinned).

3. **Workspace-scope the auto-linker reciprocal lookup**
   - Files: `web/src/server/search/auto-linker.ts` [MODIFY], `web/src/server/search/auto-linker.test.ts` [MODIFY]
   - Implements FR-TG4.3
   - **Bug (medium, logic-error):** the similarity pass's reciprocal-link lookup selects from `permanentMemories` by `filePath` alone — a workspace-relative, non-unique path (e.g. `memory/facts/foo.md`). On a cross-workspace filename collision, `.get()` can return another workspace's row, whose `linkedMemories`/`updatedAt` get overwritten with a path from the wrong workspace while the correct row stays stale. The tag/theme pass (`findTagThemeSiblings`) correctly scopes by workspaceId, confirming the intended invariant.
   - **Fix:** add the `workspaceId` predicate to the lookup, matching every other permanentMemories query.
   - **Acceptance:** test with two workspaces sharing a memory filePath — linking in one never mutates the other's row.

4. **Exclude seeded READMEs from validation checks**
   - Files: `web/src/server/search/validate.ts` [MODIFY], `web/src/server/search/validate.test.ts` [MODIFY]
   - Implements FR-TG4.4
   - **Bug (medium, logic-error):** `initMemoryDirs` seeds a description-only README.md into every `memory/{subtype}/` dir, and the indexer deliberately skips READMEs in the permanentMemories mirror — but validate's `walkMemoryFiles` includes any `*.md`, so `checkOrphanedContent` warns 'no permanentMemories row' for all five seeded READMEs on every run, and `checkSchemaCompliance`'s `isSubtypeFile` regex matches them too ('Missing required frontmatter field: title/subtype'). The tests currently filter README paths out instead of the checks excluding them — ~15 systematic false positives ship in every real report (including the MCP validateWorkspace tool, which returns the raw report).
   - **Fix:** exclude `README.md` in `walkMemoryFiles`/`isSubtypeFile` (matching the indexer's skip rule); remove the test-side workaround filters so tests pin the real behavior.
   - **Acceptance:** validating a freshly-initialized workspace yields zero README-related warnings; tests no longer filter READMEs.

5. **Close the status-only filter leak (tRPC + MCP)**
   - Files: `web/src/server/trpc/routers/search.ts` [MODIFY], `web/src/server/mcp/index.ts` [MODIFY], `web/src/server/trpc/routers/search.test.ts` [MODIFY], `web/src/server/mcp/index.test.ts` [MODIFY]
   - Implements FR-TG4.5
   - **Bug (medium ×2, logic-error):** `buildFrontmatterConditions` (tRPC) and `buildFrontmatterWhereCondition` (MCP) ignore the `status` filter (tasks-only), but `filtersOnlyMode`/`queryWithFiltersMode` and `mcpFiltersOnly`/`mcpQueryWithFilters` still run the frontmatter query whenever collection ≠ 'tasks'. A `filters: {status: 'done'}` query degenerates to `workspaceId = ?` and returns up to `limit` arbitrary docs from all collections as "matches" (empirically reproduced on the MCP path; a tRPC test even pins the leak as a side effect). MCP↔tRPC parity rules mean both must change together.
   - **Fix:** when the only effective filters are task-only fields (status), skip the frontmatter query entirely (return task results only); apply identically in both routers per the MCP CLAUDE.md parity rule.
   - **Acceptance:** both routers' tests assert a status-only filter returns task hits only, with seeded non-task frontmatter rows present.

6. **Bound the README index chain to the workspace**
   - Files: `web/src/server/lib/readme-index.ts` [MODIFY], `web/src/server/lib/memory-files.ts` [MODIFY], `web/src/server/lib/readme-index.test.ts` [MODIFY]
   - Implements FR-TG4.6
   - **Bug (high, path-handling):** `regenerateReadmeChain` walks up a fixed 4 levels from a memory file, visiting the subtype dir, `memory/`, the workspace root, and the workspace root's *parent* — unconditionally writing/appending an INDEX block to `README.md` there (`{ENGY_DIR}/README.md`, or the user's own directory when docsDir is nested; verified by repro on an existing parent README). This violates the 'server never touches user repos' invariant. Secondary: the workspace-root README it creates is excluded by `collectReadmePaths` (stops below root), so every memory commit leaves the workspace repo permanently dirty.
   - **Fix:** walk up only until the workspace root (pass the root in and stop there), never beyond; include the root README in `collectReadmePaths` (or stop the chain below root) so commits stay clean.
   - **Acceptance:** test that regenerating from a deep memory path writes no file above the workspace root and the commit path set covers every README written.

**Parallelizable:** All six tasks are file-disjoint and can run concurrently.

### Completion Summary

## TG5: Project, Milestone & Plan File Safety

Plan and project file operations can silently destroy user content: unconditional overwrites, a line-based frontmatter format corrupted by multi-line input, raw-string path guards, and an unscoped readiness check.

### Requirements

1. `milestone.create` shall never overwrite an existing plan file and shall reject duplicate milestone numbers. *(source: user request)* (FR-TG5.1)
2. Milestone frontmatter parsing shall validate `status` against the enum, and serialization shall not be corruptible by newlines in title/scope. *(source: user request)* (FR-TG5.2)
3. Project file path guards shall operate on normalized relative paths; `deleteDir` shall never resolve to the project root. *(source: user request)* (FR-TG5.3)
4. `project.create` shall not overwrite an existing on-disk `spec.md`. *(source: user request)* (FR-TG5.4)
5. `checkProjectReadiness` shall only consider tasks belonging to the project's own workspace/project. *(source: user request)* (FR-TG5.5)
6. The M7 backfill shall append `.qmd/` to `.gitignore` without corrupting the existing last rule. *(source: user request)* (FR-TG5.6)

### Tasks

1. **Milestone plan file guards and frontmatter robustness**
   - Files: `web/src/server/trpc/routers/milestone.ts` [MODIFY], `web/src/server/plan/service.ts` [MODIFY], `web/src/server/plan/service.test.ts` [MODIFY], `web/src/server/trpc/routers/milestone.test.ts` [MODIFY]
   - Implements FR-TG5.1, FR-TG5.2
   - **Bug A (medium, edge-case):** `milestone.create` computes `m{num}-{slug}.plan.md` and calls `writePlanFile`, which is an unconditional `writeFileSync` — re-creating a milestone with the same num+title replaces the whole plan (task groups, body) with an empty frontmatter stub. The UI defaults num to 1 with no duplicate check. Duplicate nums with different titles also produce two files sharing ref `m{num}`, making `milestoneRef` lookups ambiguous.
   - **Bug B (low, state-bug):** `listMilestones` casts any frontmatter status string through unvalidated (`'' as well, since '' survives ??`). Agent-authored plan files use values like `draft` (the milestone-plan skill writes them), for which `validateStatusTransition`'s indexOf yields -1 — only 'planned' is then accepted while legitimate transitions are rejected, and the UI receives out-of-enum statuses.
   - **Bug C (low, edge-case):** `buildMilestoneFrontmatter` interpolates title/scope raw into `title:`/`scope:` lines; the UI scope field is a multi-line Textarea and zod validates only `min(1)`. The line-based `parseFrontmatter` then truncates everything after the first line, and the routine status-advance flow rewrites the file from the truncated parse — permanently destroying the rest of the scope (reproduced end-to-end).
   - **Fix:** (A) existence check before write + reject duplicate num in create. (B) validate parsed status against the MilestoneStatus enum, falling back to 'planned' for unknown/empty with a console warning. (C) either reject newlines in zod for title and escape/fold scope on serialize, or switch the two fields to single-line + quoted serialization that `parseFrontmatter` round-trips; pin round-trip in tests.
   - **Acceptance:** create-twice preserves the original file and errors; multi-line scope round-trips (or is rejected at input); out-of-enum frontmatter status normalizes without breaking transitions.

2. **Project file path normalization and scoping**
   - Files: `web/src/server/trpc/routers/project.ts` [MODIFY], `web/src/server/project/service.ts` [MODIFY], `web/src/server/project/service.test.ts` [MODIFY], `web/src/server/trpc/routers/project.test.ts` [MODIFY]
   - Implements FR-TG5.3, FR-TG5.4, FR-TG5.5
   - **Bug A (medium, path-handling):** `writeFile`/`deleteFile`/`renameFile` protect spec.md with raw-string zod refines (`p !== 'spec.md'`) while `validatePath` resolves afterwards — `./spec.md` or `docs/../spec.md` bypasses the guard, allowing spec.md overwrite (skipping status-transition validation), delete, or rename. `deleteDir` accepts `'.'`, which resolves to the project root and `rmSync(recursive)` deletes the entire project directory including spec.md.
   - **Bug B (medium, edge-case):** `initProjectDir` does `mkdirSync(recursive)` then unconditionally writes a placeholder spec.md; slug uniqueness is DB-only, so creating a project whose directory already exists on disk (restored from git, hand-authored) destroys the existing spec. `project.getBySlug` already guards its own `initProjectDir` call with `existsSync` — `project.create` does not.
   - **Bug C (medium, logic-error):** `checkProjectReadiness` selects tasks by `eq(tasks.specId, projectSlug)` with no workspace/project scoping; slugs are only unique per workspace, so another workspace's same-slug project (e.g. the common 'initial') blocks this project's draft→ready transition with a misleading 'incomplete tasks exist'.
   - **Fix:** (A) normalize/resolve the relative path first and compare the normalized value in the guards; reject `''`/`'.'` in deleteDir after normalization. (B) `existsSync(specMdPath)` guard before writing the placeholder. (C) add project/workspace scoping to the readiness query.
   - **Acceptance:** `./spec.md`, `docs/../spec.md`, and `'.'` are all rejected; creating a project over an existing dir preserves spec.md; readiness ignores other workspaces' tasks.

3. **Backfill .gitignore newline guard**
   - Files: `web/src/server/engy-dir/backfill-m7.ts` [MODIFY], `web/src/server/engy-dir/backfill-m7.test.ts` [MODIFY]
   - Implements FR-TG5.6
   - **Bug (low, edge-case):** when a legacy workspace's `.gitignore` exists, lacks `.qmd`, and has no trailing newline, the backfill appends `` `${existing}.qmd/\n` `` — corrupting the last rule (`node_modules` → `node_modules.qmd/`), after which `git add '.'` commits the binary qmd store and previously-ignored files. The corruption self-masks: `includes('.qmd')` matches the mangled line, so repair is skipped forever (sandbox-reproduced).
   - **Fix:** ensure a separating newline before appending when the existing content doesn't end with one.
   - **Acceptance:** test both with- and without-trailing-newline fixtures produce two intact rules.

**Parallelizable:** All three tasks are file-disjoint.

### Completion Summary

## TG6: Client Daemon Misc

Smaller daemon defects: a watcher that ignores docsDir changes, an unquoted remote command, a status probe with side effects, a porcelain-parse edge case, and a TOCTOU pidfile. Sequenced after TG1/TG2 because two tasks share files with them.

### Requirements

1. `SpecWatcher.sync` shall re-create a workspace's watcher when its docsDir changes. *(source: user request)* (FR-TG6.1)
2. All remote commands built for `coder ssh` shall quote their arguments with `shellQuote()`. *(source: user request)* (FR-TG6.2)
3. `ContainerManager.status()` shall report container state without starting a stopped container. *(source: user request)* (FR-TG6.3)
4. Git status parsing shall report the correct branch name for repositories with no commits. *(source: user request)* (FR-TG6.4)
5. Pidfile acquisition shall be atomic, so two concurrently-started daemons cannot both proceed. *(source: user request)* (FR-TG6.5)

### Tasks

1. **Watcher reacts to docsDir changes**
   - Files: `client/src/watcher.ts` [MODIFY], `client/src/watcher.test.ts` [MODIFY]
   - Implements FR-TG6.1
   - **Bug (medium, state-bug):** `sync()` keys watchers by slug only — `if (!this.watchers.has(ws.slug))` skips a workspace whose incoming WORKSPACES_SYNC carries a changed `docsDir`, so after the user repoints the docs directory the daemon silently keeps watching the old path (no FILE_CHANGE for the new one) until restart or remove/re-add.
   - **Fix:** store the watched docsDir alongside each watcher; on sync, if it differs, close and re-create the watcher at the new path.
   - **Acceptance:** test that a second sync with a changed docsDir emits FILE_CHANGE for files under the new path and not the old.

2. **Quote coder remote worktree command** (after TG1 — shares `runner/index.ts`)
   - Files: `client/src/runner/index.ts` [MODIFY], `client/src/runner/index.test.ts` [MODIFY]
   - Implements FR-TG6.2
   - **Bug (low, path-handling):** `Runner.start()` builds the remote `git worktree add` for coder mode passing raw `remoteRepoPath`/`worktreePath` to `coder ssh --`, which re-parses args through the remote shell — a path with a space (coderRepoBasePath is free text, e.g. `~/My Projects`) splits into multiple words. `CoderManager.exec`/`execCapture` use `shellQuote()` for exactly this; `client/src/container/CLAUDE.md` documents the invariant. `shellQuote` preserves leading `~/`, so quoting doesn't break tilde expansion.
   - **Fix:** route the worktree-add command through `shellQuote()` like CoderManager does.
   - **Acceptance:** test pins the quoted command string for a path containing a space.

3. **Side-effect-free container status**
   - Files: `client/src/container/manager.ts` [MODIFY], `client/src/container/manager.test.ts` [MODIFY]
   - Implements FR-TG6.3
   - **Bug (low, state-bug):** `status()` probes via `devcontainer up --expect-existing-container`, but that flag only prevents *creating* — verified against the installed CLI, a stopped container gets `docker start`ed, so status() restarts it, reports `running: true`, and leaves it running; `down()` on a stopped container briefly restarts it before stopping again. Currently latent server-side (only CONTAINER_UP is dispatched today) but the protocol and client handlers are fully wired.
   - **Fix:** probe with a read-only `docker inspect` (filtered by the devcontainer's workspace-folder label) instead of `devcontainer up`.
   - **Acceptance:** test that status() against a stopped container reports not-running and issues no start command.

4. **Branch name for no-commit repos**
   - Files: `client/src/git/index.ts` [MODIFY], `client/src/git/index.test.ts` [MODIFY]
   - Implements FR-TG6.4
   - **Bug (low, logic-error):** `parsePorcelainStatus` special-cases only `## HEAD (no branch)`; a fresh repo emits `## No commits yet on main`, and the `split` yields branch `'No'` (empirically verified). All fresh-repo tests commit first, so nothing pins this.
   - **Fix:** handle the `No commits yet on <branch>` header form and return the actual branch.
   - **Acceptance:** test with a no-commit repo fixture asserts branch 'main'.

5. **Atomic pidfile acquisition** (after TG2 — shares `client/src/index.ts`)
   - Files: `client/src/index.ts` [MODIFY], `client/src/index.test.ts` [NEW or MODIFY as exists]
   - Implements FR-TG6.5
   - **Bug (low, race-condition):** `acquirePidFile()` is read → liveness-check → unconditional `writeFileSync` — no O_EXCL. Two daemons starting concurrently (supervisor crash-restart racing a manual start) both pass the stale check and both run; the loser's `releasePidFile` no-ops, violating the single-daemon invariant.
   - **Fix:** write with the `wx` flag; on EEXIST, read the pid, and only if it's stale unlink + retry once. Verify ownership (pid matches) before releasing.
   - **Acceptance:** test that a second acquire against a live pidfile throws, and against a stale pidfile succeeds exactly once.

**Parallelizable:** Tasks 1, 3, 4 are disjoint and immediate; task 2 waits on TG1, task 5 on TG2.

### Completion Summary

## TG7: Editor & Comments

Comment anchoring silently lands on the wrong text or orphans threads, comment persistence is fire-and-forget, and the mermaid preview can show stale renders.

### Requirements

1. Comment anchor matching shall map fallback (normalized) matches back to correct original-document offsets. *(source: user request)* (FR-TG7.1)
2. Comment anchor resolution shall handle matches ending at the exact end of the document. *(source: user request)* (FR-TG7.2)
3. Comment mutations shall surface persistence failures instead of silently diverging from the DB. *(source: user request)* (FR-TG7.3)
4. The mermaid preview shall never display the result of a superseded render. *(source: user request)* (FR-TG7.4)

### Tasks

1. **Anchor matcher offset correctness**
   - Files: `web/src/components/editor/comments/matcher.ts` [MODIFY], `web/src/components/editor/comments/matcher.test.ts` [MODIFY]
   - Implements FR-TG7.1, FR-TG7.2
   - **Bug A (medium, logic-error):** `findTextQuoteMatch`'s fallback searches `norm(fullText)` (whitespace collapsed, trimmed, lowercased) and records occurrence offsets into that normalized string — then feeds them to `textOffsetToPmPos`, which walks the ORIGINAL doc text. Any multi-whitespace run before the match (code/mermaid block indentation, newlines) shifts the offsets, so on reconcile the comment mark is silently applied to the wrong range.
   - **Bug B (medium, edge-case):** `textOffsetToPmPos` resolves only when `count + len > textOffset`; for a match ending at the document's last character, `to` equals total text length and the function returns -1, so `findTextQuoteMatch` returns null — comments anchored at the end of a doc (a common spot) orphan on every reload despite the exact text being present (traversal-simulated).
   - **Fix:** (A) build an index map from normalized offsets back to original offsets during normalization (or search with a whitespace-flexible regex over the original text). (B) accept `textOffset === totalLength` as the position after the final text node.
   - **Acceptance:** unit tests: match after a multi-newline code block lands on the exact original range; a quote ending at the last character of the doc resolves.

2. **Thread store persistence error handling**
   - Files: `web/src/components/editor/thread-store.ts` [MODIFY], `web/src/components/editor/thread-store.test.ts` [NEW or MODIFY as exists]
   - Implements FR-TG7.3
   - **Bug (medium, error-handling):** every `EngyThreadStore` method (createThread, addComment, updateComment, deleteComment, deleteThread, resolve/unresolve, reactions, setThreadMetadata) applies the change optimistically and calls `client.comment.*.mutate(...)` without awaiting or `.catch`. Failures become unhandled rejections, the user gets no feedback, and comments shown as saved vanish on reload; failures cascade (a failed createThread breaks all subsequent ops on that thread). `setThreadMetadata` fires on every save via snapshotAnchors, amplifying exposure.
   - **Fix:** attach `.catch` to every mutation: roll the optimistic change back in the local map and emit a visible error (toast / store error state). Keep mutations non-blocking; no behavioral change on success.
   - **Acceptance:** test that a rejected mutation restores the prior in-memory state and reports the error.

3. **Mermaid render ordering guard**
   - Files: `web/src/components/editor/mermaid/preview.tsx` [MODIFY]
   - Implements FR-TG7.4
   - **Bug (low, race-condition):** the debounce timer is cleared on code change, but an awaited in-flight `renderDiagram()` has no cancellation — mermaid's lazy per-diagram-type chunk loading makes a slow older render realistically resolve after a fast newer one and overwrite the newer SVG/error state.
   - **Fix:** render-generation counter captured per invocation; discard results whose generation is stale (also covers unmount).
   - **Acceptance:** manual: rapid diagram-type switches in the edit dialog never regress to the older diagram; code review of the guard.

**Parallelizable:** All three tasks are file-disjoint.

### Completion Summary

## TG8: Terminal-Active State (web UI)

The `window.__engy_terminal_active` global + tabId-filtered event scheme has three coherence bugs, and the activity parser misreads split escape sequences. Together they make "Send to Active Terminal" affordances lie.

### Requirements

1. Dockview event handlers shall always observe the current tab-active state, not a mount-time snapshot. *(source: user request)* (FR-TG8.1)
2. A TerminalManager unmounting while its tab owned the global terminal-active flag shall clear it. *(source: user request)* (FR-TG8.2)
3. `useTerminalActive` shall not seed per-tab state from another tab's global value. *(source: user request)* (FR-TG8.3)
4. Terminal activity parsing shall handle OSC sequences split across data chunks without emitting phantom bells. *(source: user request)* (FR-TG8.4)

### Tasks

1. **Fresh-closure event handling + flag lifecycle in TerminalManager**
   - Files: `web/src/components/terminal/terminal-manager.tsx` [MODIFY], `web/src/components/terminal/terminal.tsx` [MODIFY]
   - Implements FR-TG8.1, FR-TG8.2
   - **Bug A (medium, state-bug):** `handleDockviewReady` registers `onDidActivePanelChange`/`onDidRemovePanel` once (dockview's onReady fires once), capturing `broadcastActive` as of mount; its gate reads a frozen `tabCtx?.isActive`. `TerminalInstance` similarly freezes `onStatusChange`/`onActivity` in its mount-only effect. A manager in a formerly-active tab keeps writing the global flag (clobbering the truly active tab), while a manager mounted hidden never writes it once activated — so `useTerminalActive`'s initial read and Send-to-Active-Terminal enablement are wrong.
   - **Bug B (medium, state-bug):** the unmount cleanup's comment says 'clear if we were the active tab', but the code clears only when `!tabId` — which never happens since every manager runs under TabContext. Closing a tab with an active terminal leaves the global stuck `true` with zero terminals.
   - **Fix:** keep latest `tabCtx.isActive`/callbacks in refs read inside the registered handlers (standard latest-ref pattern); in cleanup, clear the global when this tab's manager last wrote `true` (track ownership), matching the comment's stated intent.
   - **Acceptance:** playwright-cli: open terminal in tab A, switch to tab B — send-to-terminal state follows the active tab; closing the terminal-owning tab disables the affordances.

2. **Per-tab seeding for useTerminalActive** (depends on task 1 — terminal-manager.tsx defines the write side)
   - Files: `web/src/components/terminal/use-terminal-active.ts` [MODIFY], `web/src/components/terminal/use-terminal-active.test.ts` [MODIFY]
   - Implements FR-TG8.3
   - **Bug (low, state-bug):** the hook seeds initial state from the shared `window.__engy_terminal_active` while filtering subsequent updates by `detail.tabId` — a component mounting in a different (inactive) virtual tab inherits the other tab's value, and a tab whose manager has no terminal events never corrects it. Verified consumers: plan-actions, send-to-terminal-button, review-actions render enabled and silently no-op.
   - **Fix:** scope the seed to the tab — e.g. a per-tab map (`window.__engy_terminal_active_by_tab`) written by the manager (task 1) and read with the consumer's tabId, defaulting false.
   - **Acceptance:** test that a consumer in tab B seeds false while tab A's flag is true.

3. **Stateful OSC parsing across chunks**
   - Files: `web/src/components/terminal/parse-terminal-activity.ts` [MODIFY], `web/src/components/terminal/parse-terminal-activity.test.ts` [MODIFY], `web/src/components/terminal/terminal.tsx` [MODIFY — after task 1; thread parser state per session]
   - Implements FR-TG8.4
   - **Bug (low, edge-case):** `parseTerminalActivity` is stateless per WS chunk; an OSC title sequence split across two chunks (routine under heavy agent output — the daemon relays raw node-pty chunks) leaves the first chunk's unterminated OSC skipped and the second chunk's BEL counted as a standalone bell, which `handleBell` turns into an unconditional 'waiting' state for a busy terminal.
   - **Fix:** make the parser stateful per session (carry an 'inside-OSC' flag / tail buffer between calls); the caller in terminal.tsx holds one parser instance per session.
   - **Acceptance:** unit test feeding an OSC sequence split at several boundaries asserts zero bells; an intact real BEL still counts.

**Parallelizable:** Task 3's parser work can start immediately (parse-terminal-activity.ts is disjoint); its terminal.tsx wiring and task 2 follow task 1.

### Completion Summary

## TG9: Web UI Data-Loss & Race Fixes

Independent frontend bugs that lose user data or duplicate work: a zombie events socket, discarded auto-saves, worktree-blind quick actions, and a kanban snap-back.

### Requirements

1. The events WebSocket shall stop reconnecting once its provider unmounts, and shall never run two connection chains concurrently. *(source: user request)* (FR-TG9.1)
2. Pending debounced auto-saves shall be flushed — not discarded — when the file selection changes or the editor unmounts, and writes shall not land out of order. *(source: user request)* (FR-TG9.2)
3. Quick actions shall target the active worktree's group key and working directory when `?wt` is selected. *(source: user request)* (FR-TG9.3)
4. A dragged kanban card shall remain in its target column until the refetched data confirms the move. *(source: user request)* (FR-TG9.4)

### Tasks

1. **EventsProvider disposal guard**
   - Files: `web/src/contexts/events-context.tsx` [MODIFY]
   - Implements FR-TG9.1
   - **Bug (high, resource-leak):** the effect cleanup calls `wsRef.current.close()` but never detaches `ws.onclose`; the close event fires after cleanup and unconditionally schedules `setTimeout(connect, 3000)` — a timer created *after* the cleanup's clearTimeout ran. Every unmount/workspaceSlug change spawns a zombie chain reconnecting forever, and on workspace change the old chain runs beside the new one, delivering every server event N+1 times (multiplying invalidations and terminal-session syncs).
   - **Fix:** a `disposed` flag set in cleanup, checked in `onclose` before scheduling; also null the handlers on the socket being discarded.
   - **Acceptance:** unit/playwright: after navigating across workspaces several times, exactly one `/ws/events` connection exists and events fire once.

2. **Flush-on-switch auto-save**
   - Files: `web/src/components/diff/use-auto-save.ts` [MODIFY], `web/src/components/diff/use-auto-save.test.ts` [NEW or MODIFY as exists]
   - Implements FR-TG9.2
   - **Bug (medium, data-loss; found independently by two finders):** the debounced 1s save timer is cleared without flushing both in the resetKey effect (repoDir/filePath change) and the unmount cleanup. The pending closure holds the correct old repoDir/filePath/content, so flushing is safe — instead, the last <1s of edits are silently dropped when the user clicks another file in code-page/diffs-page or closes the panel; no other save path exists (no save button, no onBlur). Secondary: overlapping in-flight writes (slow A, fast B) can land out of order, leaving stale content with status 'saved'.
   - **Fix:** on reset/unmount, if a timer is pending, fire the save immediately (flush) instead of discarding; serialize writes per file (chain on the previous promise or drop stale responses by sequence number).
   - **Acceptance:** test that editing then immediately switching files persists the last edit; out-of-order completion never overwrites newer content.

3. **Worktree-aware quick actions**
   - Files: `web/src/hooks/use-quick-action.ts` [MODIFY], `web/src/hooks/use-quick-action.test.ts` [NEW or MODIFY as exists]
   - Implements FR-TG9.3
   - **Bug (medium, state-bug):** `useQuickAction` hand-rolls `` `project:${workspaceSlug}:${projectSlug}` `` instead of using `projectGroupKey()` from group-key.ts (whose docstring exists to prevent exactly this drift) and never reads the `?wt` param or the worktree repo map. A plan/implement quick action launched on a worktree tab runs Claude against the MAIN checkout and registers under the default-branch group — reattaching to the wrong tab after reload, with agent edits landing on the main checkout. The worktree PR updated useTerminalScope/layout but missed this hook.
   - **Fix:** use `projectGroupKey(workspaceSlug, projectSlug, worktreeBranch)` and remap workingDir through the same worktree map the terminal panel uses (`use-terminal-scope.ts` / `use-project-worktree-map.ts` patterns).
   - **Acceptance:** test that with a wt param the generated group key carries the `:wt:<branch>` suffix and workingDir points at the worktree path.

4. **Kanban optimistic-move settle ordering**
   - Files: `web/src/components/projects/task-views/kanban-board.tsx` [MODIFY]
   - Implements FR-TG9.4
   - **Bug (low, optimistic-update):** `updateTask`'s `onSettled` synchronously deletes `pendingMoves[id]` then calls `utils.task.list.invalidate()` without awaiting — for one refetch round trip the component renders the stale tasks prop and the dragged card visibly snaps back to its old column (every drag; pronounced on remote servers).
   - **Fix:** await the invalidate/refetch before removing the pending override (or remove it in a `.then` of the refetch promise), so the override outlives the stale render window.
   - **Acceptance:** playwright-cli: dragging a card across columns shows no snap-back flicker (verify with a throttled network if needed).

**Parallelizable:** All four tasks are file-disjoint.

### Completion Summary

## TG10: Error Surfacing & Data Integrity (live hunt)

The live hunt found the dev instance running with a silently desynced migration journal (two recorded hashes match no migration file, so `permanent_memories`/`frontmatter` were never created), and every resulting 500 rendered as an empty state. This group makes failures detectable and visible: migrations fail fast on desync, and the UI distinguishes "error" from "empty".

### Requirements

1. `runMigrations` shall detect a migration journal entry whose hash matches no current migration file and fail fast with a descriptive error naming the desynced entries and the recovery options. *(source: user request)* (FR-TG10.1)
2. The Memory tab shall render a distinct error state when `memory.list`/`memory.reviewCandidates` fail, never the "No memories found" empty state. *(source: user request)* (FR-TG10.2)
3. Global search shall transition to a visible error state when `search.query` fails, for all query lengths — never an indefinite "Searching…" spinner or a silent "No results found." *(source: user request)* (FR-TG10.3)
4. The Open Directory dialog shall surface directory-listing failures inline, and the server shall reject a nonexistent path with a 4xx (`NOT_FOUND`/`BAD_REQUEST`), not a 500. *(source: user request)* (FR-TG10.4)
5. The Shared Docs tree shall resolve its section directory without doubling the path segment, and shall render an error state (not "No files yet") when the listing fails. *(source: user request)* (FR-TG10.5)
6. Workspace name and slug shall reject path-separator characters at both the form and the router schema. *(source: user request)* (FR-TG10.6)

### Tasks

1. **Migration journal desync detection**
   - Files: `web/src/server/db/migrate.ts` [MODIFY], `web/src/server/db/migrate.test.ts` [NEW or MODIFY as exists]
   - Implements FR-TG10.1
   - **Bug (critical, data-integrity):** the dev DB records 22 migration hashes while the repo has 20 migration files; two recorded hashes match no file (a regenerated migration left its old hash in the journal), so Drizzle's `runMigrations()` treats the DB as up-to-date and never creates `permanent_memories`/`frontmatter`. Verified via sqlite3: both tables absent. Every memory/search procedure then 500s with no recovery path anywhere in the UI.
   - **Fix:** after (or before) running migrations, cross-check the journal's recorded hashes against the migration folder; on a mismatch, throw at startup with an error listing the orphaned journal entries and the fix (restore the missing migration files or reset the journal). Fail fast per the error-handling principles — do not boot into a silently broken state.
   - **Acceptance:** test seeds a journal row with a hash matching no file — startup throws with the entry named; a clean journal boots normally.

2. **Memory tab and global search error states**
   - Files: `web/src/components/memory/memory-browser.tsx` [MODIFY], `web/src/components/search/global-search.tsx` [MODIFY], `web/src/server/trpc/routers/search.ts` [MODIFY — error mapping; coordinate with TG4 task 5 which also touches this file: serialize after it]
   - Implements FR-TG10.2, FR-TG10.3
   - **Bug (high, error-handling):** with the backend 500ing, the Memory tab shows "No memories found" (search box and subtype filters included), and global search has two failure modes for the same error: multi-char queries hang on "Searching…" forever (the 30–60s 500 never updates the UI) while short queries silently show "No results found." Users cannot distinguish a broken index from genuinely empty data. The search router's error mapping only converts messages containing 'download'/'model' to `PRECONDITION_FAILED`; everything else surfaces as a raw 500.
   - **Fix:** branch on the query error state in both components and render an explicit error message (retry affordance optional); in the search router, map store/init failures to a typed TRPCError so the client can show a meaningful message.
   - **Acceptance:** with the search/memory procedure mocked to fail, the Memory tab and search dialog show error states; the spinner always terminates.

3. **Open Directory listing failures**
   - Files: `web/src/server/trpc/routers/file.ts` [MODIFY], `web/src/components/open-dir/open-dir-dialog.tsx` [MODIFY], `web/src/components/dir-path-input.tsx` [MODIFY if the error renders there], `web/src/server/trpc/routers/file.test.ts` [MODIFY]
   - Implements FR-TG10.4
   - **Bug (medium, error-handling):** typing a nonexistent path in the Open Directory dialog fires `file.listDir`, which returns HTTP 500; the listing area silently disappears with no error indicator and the Open button stays active.
   - **Fix:** `listDir` returns `NOT_FOUND` for missing paths (ENOENT → typed error, not a generic throw); the dialog renders an inline "directory not found" message and disables Open while the path is invalid.
   - **Acceptance:** router test pins NOT_FOUND for a missing path; dialog shows the message (playwright-cli check).

4. **Shared Docs section path and error state**
   - Files: `web/src/app/w/[workspace]/docs/docs-tree.tsx` [MODIFY]
   - Implements FR-TG10.5
   - **Bug (medium, path-handling):** the Shared Docs tree computes its directory as `path.join(rootDir, 'docs')` where `rootDir` is already the workspace `docsDir` — for this workspace (`/Users/aleks/dev/engy/docs`) that doubles to `docs/docs`, which 404s on every Docs-tab visit; the 404 is swallowed and rendered as "No files yet". System Docs (section 'system') resolves fine, confirming the section-join pattern; the failure mode is any docsDir lacking a literal `docs/` subdirectory.
   - **Fix:** decide the canonical shared-docs location (per the M7 layout, `{workspaceDir}/docs/`) and create it on init if missing (coordinate with `initWorkspaceDir`), or stop querying a section that doesn't exist; either way render listing errors distinctly from empty.
   - **Acceptance:** Docs tab loads with zero 404s on a standard workspace; a failed listing shows an error state, not "No files yet".

5. **Workspace name/slug validation** (after TG3 — shares `routers/workspace.ts`)
   - Files: `web/src/components/create-workspace-dialog.tsx` [MODIFY], `web/src/components/workspace/edit-workspace-dialog.tsx` [MODIFY], `web/src/server/trpc/routers/workspace.ts` [MODIFY], `web/src/server/trpc/routers/workspace.test.ts` [MODIFY]
   - Implements FR-TG10.6
   - **Bug (medium, validation):** workspace name and slug accept `/` (and other path separators) with no client validation; the edit dialog even previews the broken URL (`Used in the URL: /w/my/slug`). A slash-bearing slug breaks `/w/<slug>` routing and the on-disk workspace dir naming.
   - **Fix:** zod refine on the router (slug: `[a-z0-9-]+` or equivalent existing slugify contract; name: no path separators) plus inline form errors in both dialogs.
   - **Acceptance:** router test rejects `my/slug`; both dialogs show inline errors and disable submit.

**Parallelizable:** Tasks 1, 3, 4 immediately; task 2 after TG4 task 5; task 5 after TG3 task 4.

### Completion Summary

## TG11: UI Defects (live hunt)

Visible defects reproduced in the browser: the comments sidebar destroys the editor layout, the Monaco diff editor throws on every file switch, the milestones panel's filter and expansion are broken, and task-view filters drift between views. Plus a swept batch of small polish items.

### Requirements

1. Opening the comments sidebar shall not collapse the document editor pane; comment action menus shall render fully within the viewport. *(source: user request)* (FR-TG11.1)
2. Switching or closing diff files shall not throw Monaco TextModel disposal errors. *(source: user request)* (FR-TG11.2)
3. The milestones panel "Show done" toggle shall filter completed milestones, and expanding a milestone shall render its task groups. *(source: user request)* (FR-TG11.3)
4. Task filter state shall be consistent across view modes and scoped (or visibly indicated) per project. *(source: user request)* (FR-TG11.4)
5. Task deletion shall require confirmation. *(source: user request)* (FR-TG11.5)
6. Terminal tabs and workspace tabs with identical contexts shall carry distinguishing labels. *(source: user request)* (FR-TG11.6)
7. Unknown sub-routes shall render a proper not-found page instead of raw "No view for …" text. *(source: user request)* (FR-TG11.7)
8. Wide editor content (tables, code blocks) shall be horizontally scrollable instead of clipped, and console noise (linkifyjs double-init, missing dialog descriptions, duplicate fetches) shall be eliminated. *(source: user request)* (FR-TG11.8)

### Tasks

1. **Comments sidebar layout collapse** (after TG7 task 1 — same review surface)
   - Files: `web/src/components/editor/document-editor.tsx` [MODIFY], plus the comments sidebar/panel styles it renders
   - Implements FR-TG11.1
   - **Bug (high, layout):** adding or viewing a comment in the spec editor squeezes the editor pane to ~one character wide — the document renders vertically, one letter per line — recovering only when the panel closes. The comment "…" action menu also renders clipped at the right viewport edge. Repro: open `spec.md`, select a word, add a comment via the toolbar bubble; screenshots from the 2026-06-11 hunt.
   - **Fix:** constrain the comments sidebar to a fixed/max width within the editor flex container (min-width on the editor pane); ensure the dropdown menu uses collision-aware positioning.
   - **Acceptance:** playwright-cli: with a comment open, the editor pane retains readable width and the action menu is fully visible.

2. **Monaco diff editor disposal ordering**
   - Files: `web/src/components/editor/monaco-diff-editor.tsx` [MODIFY]
   - Implements FR-TG11.2
   - **Bug (medium, lifecycle):** every diff file switch (and unmount when leaving the Diffs page) throws `Uncaught Error: TextModel got disposed before DiffEditorWidget model got reset` — the cleanup effect disposes the TextModels before resetting/disposing the DiffEditorWidget that still references them.
   - **Fix:** in the cleanup/model-swap path, call `editor.setModel(null)` (or dispose the widget) before disposing the old original/modified TextModels.
   - **Acceptance:** switching between two changed files and navigating away from the Diffs page produces zero console errors (playwright-cli `console error`).

3. **Milestones panel: Show done filter and expansion content**
   - Files: `web/src/components/projects/milestone-list.tsx` [MODIFY], `web/src/components/projects/project-overview.tsx` [MODIFY if the toggle lives there]
   - Implements FR-TG11.3
   - **Bug (medium, state-bug ×2):** (a) the "Show done" toggle changes visual state but the list never changes — six "complete" milestones stay visible in both positions; (b) expanding the only expandable milestone (M5, 13/13 tasks) renders an empty row — the button reports `[expanded]` with no children, so task groups never render.
   - **Fix:** wire the toggle to actually filter `status === 'complete'` milestones; fix the expanded-content render (likely the task-group query/children mapping returning nothing for the milestoneRef).
   - **Acceptance:** playwright-cli: toggle off hides complete milestones; expanding M5 lists its task groups.

4. **Task filter consistency across views and projects**
   - Files: `web/src/components/projects/task-filter.tsx` [MODIFY], plus the view components reading filter state (kanban/matrix) as discovered
   - Implements FR-TG11.4
   - **Bug (medium, state-bug):** the filter badge reads "1" in Kanban but "2" in Eisenhower for the same project (a "Human" type filter shows active only in Eisenhower), and filter state silently persists across project navigation — 13+ tasks in another project were hidden by a filter set elsewhere, with no indication beyond the small badge.
   - **Fix:** single source of truth for filter state shared by all view modes; scope persistence per project (or surface a prominent "filtered" indicator when a carried-over filter hides results).
   - **Acceptance:** badge count identical across views; switching projects either resets filters or visibly flags them.

5. **Destructive-action confirmation and tab labels**
   - Files: `web/src/components/projects/...` task edit dialog [MODIFY — locate delete button], `web/src/components/terminal/terminal-manager.tsx` [MODIFY — panel titles; after TG8 task 1], `web/src/components/tabs/tab-shell.tsx` [MODIFY — workspace tab titles]
   - Implements FR-TG11.5, FR-TG11.6
   - **Bug (low, UX ×2):** (a) Delete in the task edit dialog removes the task instantly with no confirmation; (b) duplicate identical labels — two terminal tabs both "project: initial", two workspace tabs both "engy" — are indistinguishable.
   - **Fix:** (a) confirm dialog (existing shadcn alert-dialog pattern) before task delete; (b) suffix duplicate labels with an ordinal ("project: initial (2)") or distinguishing context.
   - **Acceptance:** delete requires confirm; opening a second same-context terminal/workspace tab yields distinct labels.

6. **Console hygiene, overflow clipping, route fallback, code-page state**
   - Files: `web/src/components/editor/document-editor.tsx` [MODIFY — linkify init guard; after task 1], task dialog components [MODIFY — add DialogDescription], `web/src/components/memory/memory-browser.tsx` [MODIFY — dedupe reviewCandidates fetch; after TG10 task 2], `web/src/app/w/[workspace]/` route fallback [MODIFY], editor styles for table/code-block overflow [MODIFY], `web/src/app/w/[workspace]/projects/[project]/code/` page state [MODIFY]
   - Implements FR-TG11.7, FR-TG11.8
   - **Bugs (low):** 20× `linkifyjs: already initialized` warnings per spec-editor mount (unguarded re-registration); Radix `DialogContent` missing description warnings on task dialogs; `memory.reviewCandidates` fetched twice on tab switch; unknown sub-route (`/w/engy/p/initial`) renders raw "No view for workspace/p"; wide tables and ASCII diagrams clip at the editor's right edge with no horizontal scroll; the Code page forgets the open file and tree expansion when navigating away and back.
   - **Fix:** guard linkify registration to once per app; add `DialogDescription`/`aria-describedby`; hoist the reviewCandidates query so mount + tab activation share one instance; add a not-found fallback for unknown workspace sub-views; `overflow-x: auto` on table/code-block wrappers; persist code-page selection in the existing tab/dock storage pattern (`doc-dock-storage.ts` precedent).
   - **Acceptance:** spec editor mounts with a clean console; unknown routes show a styled not-found; wide content scrolls horizontally; code page restores its last file.

**Parallelizable:** Tasks 2, 3, 4 immediately; 1 after TG7 task 1; 5 partially after TG8; 6 after task 1 and TG10 task 2 (shared files).

### Completion Summary

## Out of Scope

- The 20 refuted findings from the static bug hunt (verified non-bugs or unreachable; listed in workflow run `wf_4f0b2b48-9e0`).
- Repairing the damaged dev database itself (`web/.dev-engy/engy.db` missing tables) — that's a one-off ops action (reset the dev DB or reconcile the journal), not a code task; TG10 task 1 prevents the silent failure mode.
- Kanban drag-and-drop *mechanics* — the live hunt couldn't complete a drag via synthetic mouse events (likely a test-tooling limitation, no console errors); only the optimistic-update snap-back (TG9 task 4) is in scope. Revisit dnd if a human repro confirms drops failing.
- Live-hunt observations explicitly not treated as bugs: search dialog backdrop styling, dual terminal zones on the Code page, non-navigable PRs tab placeholder, `/api/terminal/sessions` polling frequency, 0/0 task counts on pre-task-system milestones.
- Execution-engine redesign (persistent sessions, crash recovery) — that's M9 Async Agents; M8 only fixes the current implementation.
- Workspace Polish scope (dashboard, notifications, settings, cost visibility) — displaced from the original M8 slot; renumber when planned.
- Protocol (`@engy/common`) message additions — all fixes work within the existing message catalog.
- UI redesign of the terminal-active affordances — only correctness of the existing flag/event scheme.
