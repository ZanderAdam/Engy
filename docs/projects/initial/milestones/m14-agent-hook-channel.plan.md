---
title: Agent Hook Channel
status: planned
---

# Plan: M14 Agent Hook Channel

## Overview

M14 gives Engy a structured control channel into every Claude session it spawns. Claude Code's hook system supports `type: "http"` handlers, and Engy already hands each spawned CLI a per-session URL (`/mcp/<sessionId>`). Adding `/hooks/<sessionId>` beside it turns agent lifecycle events — turn start, turn end, permission prompt, API failure, session start, compaction, subagent fan-out, worktree creation — into first-party POSTs instead of things Engy infers by screen-scraping the PTY.

**Terminal identity is the priority deliverable.** A terminal you cannot identify at a glance is the daily cost of running many agents at once, and Engy is the only party that knows which project, worktree and task a session belongs to while the CLI is the only party that knows what it is currently doing. TG2 puts both in the label block — agent title (or your rename) over the live branch — and turns "this one is blocked on a permission prompt" into a signal you can see across a tab strip rather than one you discover by clicking through. Most of TG2 needs no hooks at all; TG1 exists to fill the two gaps that do.

The rest of the milestone follows from the same channel: exact activity state to replace a bell-and-regex heuristic that also gates dispatch delivery, a failure state Engy is blind to today, dispatch settlement that does not depend on the model honouring a reply contract, live project context that survives `--resume`, and memory capture at the moment compaction would destroy it.

**TG1 is a go/no-go gate.** It builds the transport and proves reachability, and nothing else. The risk it retires is that the hook URL must resolve from inside all execution modes (host, devcontainer, coder), and that hook POSTs race PTY output over a different transport. If it fails, TG2 tasks 1–3 still ship — the label block, the live branch, and `--name` need no hooks — and the milestone closes there.

Boundary: **terminal sessions only** — headless execution-engine (runner) sessions have no per-session MCP identity to derive a hook URL from, so they are out of scope and unblocking them is named in Out of Scope. Claude only — Codex has no hook system and its `buildCommand` is untouched. No `PreToolUse` permission gating or runtime security guard. No `TaskCreated`/`TaskCompleted` mirroring into Engy tasks and no quality-gate enforcement. No `FileChanged` re-read notifications. No removal of the existing heuristic — it stays as the fallback for shells, Codex, runner sessions, and any non-hook session.

## Codebase Context

<!-- engy:research synthesized 2026-08-26 -->

**Prior knowledge that constrains this milestone.** No prior decision record or plan for a hooks integration exists — this is the first. Eight findings bear on it:

1. **The activity heuristic is a tuned, deliberate duplicate, and nobody has tried to replace it with a structured signal before.** `terminal-relay.md#Activity tracking` documents the mechanics: bell + prompt regex, debounced at `ACTIVITY_DEBOUNCE_MS` (3 s, defined in `client/src/terminal/manager.ts`), emitting `{t:'act', state}`. Three separate *healing* paths exist (daemon resync, `/ws/events` reseed, focus-triggered `ack`) — they patch dropped transitions rather than fix the heuristic's fuzziness at source. There is no recorded cure, only redundancy.
2. **Dispatch settlement already has a full contract — plug into it, do not rebuild it.** `FR-MCP-110/120/180/190` and `FR-TERMINAL-270/280/290` define correlation-id vs identity-based reply matching (oldest-`delivered`-wins for identified workers), idle-gated `[engy-notice]` push of async settlements into the origin terminal (queued while the origin is busy, requeued if the daemon drops mid-flush), and a worker-death path that fails all queued and delivered dispatches.
3. **Title flow is confirmed browser-detected, server-terminated.** `FR-TERMINAL-330/420`: the browser detects OSC 0/2, sends `{t:'title'}`, the server sanitizes and stores `lastTitle`, and explicitly does **not** forward to the daemon. On reconnect `lastTitle` is replayed to pending browsers right after the snapshot, because the snapshot carries no title. Nothing exists for OSC 9;4 or alternate-screen titles — TG2 is new ground.
4. **There is no convention for adding HTTP routes beside `/mcp`.** `attachMCP()` is the only precedent: mounted on the raw `http.Server` from `web/server.ts` ahead of the Next handler, identity taken from a token in the path because "the path is the only identity channel every MCP client honors." `/hooks/<sessionId>` should follow it — and TG1 should leave a decision record, since this gap is now load-bearing for two features.
5. **A `buildCommand` change must account for three spawn sites, not two.** Browser spawn, **restart-adoption**, and server-originated `spawnAgentTerminal` are three separate `terminalSessionMeta.set` production sites, and they do not handle `__ENGY_SESSION__` identically. Separately, `terminal_spawn` derives its MCP origin by regexing the *caller's own* `meta.command` for `https?://…/mcp/` — there is no env or Host-header path — which is precisely why deriving the hook URL from `mcpUrl` inside `agent-types.ts` composes correctly and a parallel `--hooks-url` option would not.
6. **Headless execution-engine agents have no MCP identity at all — this scopes M14.** `agent_sessions.sessionId` and terminal `/mcp/<token>` are decoupled namespaces that never join. `ExecutionStartConfig` carries no MCP field; execution flags are only `--append-system-prompt` / `--add-dir` plus `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`, and headless agents connect through user-scope `claude mcp add … /mcp` anonymously. **Hooks cannot reach runner sessions until that wiring exists.**
7. **Memory capture already has two paths, and the server force-sets `source`.** Headless: `FR-EXECUTION-220` parses `structured_output.memories[]` into `CREATE_MEMORIES_EVENT`. Server-side `FR-MEMORY-250` caps it at 50 items / 10,000 chars each, clamps an unknown `type` to `capture`, and **force-sets `source: 'agent'`**. Interactive terminals have no automatic path at all.
8. **CLI-native `.claude/worktrees/` is uncharted.** Engy's execution engine creates its own worktrees per spawn mode, entirely separate from anything the Claude CLI manages. `combined-worktrees.design.md` is about UI grouping by `worktreeBranch`, not creation ownership. TG7 opens a question with no prior "not yet" decision to respect.

**Suspected doc drift, worth confirming before TG1.** A June 2026 decision record states the daemon activity badge stays sticky at `done` "until typed-into/exit" because the daemon has **no** view-acknowledge signal. The working tree contradicts this: `client/src/terminal/activity-tracker.ts` exports `acknowledge()`, and M13's plan cites `FR-TERMINAL-240` for a focus `{t:'ack'}` that the server forwards to the daemon. The record appears superseded by later work. Raise it rather than coding against either claim.

<!-- /engy:research -->

**Verified against the working tree (`claude` 2.1.246):**

- `--settings <file-or-json>` accepts a **JSON string**, not just a path. This is what makes per-session hook config possible without writing files.
- **`--name <name>` sets a display name "shown in the prompt box, `/resume` picker, and terminal title."** This is a supported, hook-free lever for TG2's CLI-side identity, and it improves the CLI's own `/resume` picker as a side effect.
- **No settings key controls what the CLI writes to the title.** The settings reference documents none. So Engy cannot claim exclusive ownership of the OSC-0 stream, and any title Engy emits into the PTY can be overwritten by the CLI's next write. TG2 is designed around this rather than against it.
- `--include-hook-events` exists but only applies to `--output-format=stream-json`. The runner uses `--output-format json`, so it is not a shortcut here.

**The three activity computations.** Engy computes activity state independently in three places, feeding different surfaces:

| Where | File | Feeds |
|---|---|---|
| Daemon | `client/src/terminal/activity-parse.ts` + `activity-tracker.ts` | `{t:'act'}` → server `terminalSessionMeta.activityState` → project badges, dispatch gating |
| Browser | `web/src/components/terminal/parse-terminal-activity.ts` + `activity-tracker.ts` | local `terminal:activity-changed` CustomEvent → per-tab badges |
| Server | neither — it only stores what the daemon sends | `TERMINAL_ACTIVITY_CHANGE` broadcast |

The duplication is deliberate and documented: `@engy/common` is types-only by decision, so shared runtime logic is duplicated per-package rather than hoisted. **Do not attempt to unify them in this milestone.** Hooks add a fourth, authoritative source; the existing three stay for non-hook sessions.

**Why hook state must override rather than merge.** Hook POSTs travel browser-less over HTTP straight to the server; PTY output travels daemon → `/ws/terminal-relay` → server. Different transports, different latency. A `Stop` hook can land before the turn's trailing PTY output, and that trailing output would re-trigger `bumpActivity` and flip the session back to `active`. Once a session has produced a hook event, `{t:'act'}` for that session must be ignored server-side. This is a server-only change — the daemon keeps computing and sending, the server just stops believing it.

**Key files and what they do:**

- `web/server.ts` — the HTTP composition root. Three plain routes (`GET /api/terminal/sessions`, `GET /api/terminal/activity`, `POST /api/terminal/sessions/rename`) are matched by `url.pathname` before `isMcpPath()` short-circuits and everything else falls through to Next's `handle`. New endpoints go here, above the `isMcpPath` line. The rename route is the existing pattern for a POST with a JSON body — manual `req.on('data')` accumulation, there is no body-parser.
- `web/src/server/ws/terminal-server.ts` — the relay's `{t:'act'}` handler sets `meta.activityState`, calls `persistTerminalSession`, `broadcastTerminalActivityChange`, and `flushDispatchInbox` on `idle`/`done`. That block is inline and must be extracted for TG3. The same file's `{t:'title'}` handler sanitizes via `sanitizeOscTitle`, writes `meta.lastTitle`, and calls `updateSessionSummary` — and it already skips a title equal to `meta.lastTitle`, which is what makes TG2's server-first write idempotent against the browser echo.
- `web/src/server/ws/terminal-session-history.ts` — `updateSessionSummary(key, summary)`. **Importable directly**, so TG2 needs no `terminal-server.ts` edit and does not collide with TG3.
- `web/src/server/terminal-dispatch.ts` — `isDeliverable()` reads `activityState` and is the sole gate on dispatch delivery. `deliverDispatch()` pastes `replyContract(...)` and depends on the worker calling `terminal_reply`. `spawnAgentTerminal()` builds `mcpUrl` as `${opts.mcpOrigin}/mcp/${sessionId}`.
- `web/src/lib/agent-types.ts` — `claudeMcpFlag()` already inlines JSON via `shellEscape`, the exact precedent for `--settings`. `getMcpUrl()` returns `${window.location.origin}/mcp/${MCP_SESSION_PLACEHOLDER}` and has **~10 browser call sites**. The hook URL must therefore be **derived from `mcpUrl` inside `agent-types.ts`**, not threaded as a new option.
- `web/src/server/trpc/context.ts` — `TerminalSessionMeta`. New per-session fields land here.

**Scoping: why no opt-out flag is needed, and the one way to break that.**

Hook config travels on the command line (`--settings '<json>'`), built by `agent-types.ts` for sessions Engy spawns. It is argv, not environment and not a file on disk. The consequences:

- A `claude` the user launches by hand — in a plain terminal, or by typing `claude` at the prompt of an Engy *shell* terminal — receives no `--settings` and therefore has no hook config. It falls back to the heuristic and Engy sees a plain shell. Correct by construction; **no `ENGY_HOOKS=0`-style guard is required.**
- A child `claude` spawned from inside an Engy session's Bash does not inherit the flag either, so hooks do not cascade.
- `claude --resume <id>` run by hand outside Engy picks up the conversation without hooks. Degrades cleanly.
- Command-line settings **merge** with the user's own (`~/.claude/settings.json` is lower precedence, not replaced), so Engy adds hooks without disabling anyone's.

**The one thing that would break this: putting hooks in `plugins/engy/hooks/hooks.json`.** The Engy plugin is installed user-wide — its skills are available in every Claude session on this machine, Engy-spawned or not — so plugin-level hooks would fire everywhere, POSTing to an endpoint that knows nothing about those sessions. **All M14 hooks are per-session and inline. Do not move any of them into the plugin.** If a future hook genuinely needs to be global, it needs its own opt-out design; this milestone has none.

**Failure modes: hook events will be dropped, and the override rule must survive that.**

A dead endpoint is not a serious usability risk in itself. The browser reaches a PTY only through the server, so while the server is down the terminal is not usable regardless of hooks, and `pnpm cycle-web` builds against the running server and takes it down only for the `pm2 restart` — seconds. The realistic cost of an outage is a stray error line in scrollback and one missed update.

The serious risk is what a *dropped event* does to state. Hook POSTs can be lost to a restart, a timeout, or a crash mid-turn, and TG3 suppresses the daemon heuristic for hook-driven sessions. A missed `Stop` would then leave the session pinned at `active` with **no path back** — the existing heuristic has three documented healing paths (daemon resync `sync.activity[]`, `/ws/events` reseed, focus `ack`), and an unconditional override disables all three at once. Hence:

- **The override must be time-bounded, not absolute** (FR-TG3.2). Ignore relay `{t:'act'}` only while a hook event is recent; past that window, fall back to relay truth and let the existing healing paths work. This is what `lastHookAt` is for.
- **Every hook needs an explicit short `timeout`.** The default is **600 seconds**. Connection-refused fails fast, but a remote or firewalled server can hang, and a `Stop` hook that hangs would stall the end of a turn for ten minutes. Cheap to set, and it bounds the drop window above.
- **Register the hooks whose response is not consumed as `async`**, so a slow endpoint never sits in the turn's critical path. Only `SessionStart`'s `additionalContext` and the title/attention `terminalSequence` are read back.
- **An unknown session id must not be an error.** Sessions do outlive a server's memory of them; a non-2xx per turn prints a visible error each turn for no benefit. Return `200 {}` and log.

**The hook URL is pinned to the Engy terminal session, not the Claude conversation.** `/hooks/<sessionId>` carries the terminal session id. If the user runs `/clear` or the conversation forks, the Claude session id changes while the hook URL stays put — which is what Engy wants, since Engy tracks terminals. Do not "fix" this to follow the conversation.

**Why the hook channel is HTTP and not the daemon WebSocket.** The caller is the `claude` process, not the client daemon. The CLI cannot speak Engy's WS protocol, and the daemon has no listener at all — it only dials out (`new WebSocket(...)` in `client/src/ws/client.ts`; no `createServer`/`.listen` anywhere in `client/src`), so a hook could not reach it even in principle. Agent-CLI-to-server over HTTP is the established interface: `claudeMcpFlag` hands the CLI `/mcp/<sessionId>` and it dials the server directly, no daemon hop. The WS interface is daemon↔server, for filesystem, git, and PTY relay; hook payloads carry none of those. Routing them through the daemon would add a hop, require a helper present on the daemon host (awkward in container and coder modes), and need a new WS message per event, for nothing.

The alternative worth recording is **not** WS but `type: "mcp_tool"` — hooks can call an MCP tool, and the CLI already has the Engy MCP server configured per session, so it would add no new HTTP surface. Rejected because an MCP tool is **agent-callable**: the agent could fabricate its own lifecycle events, claim a `Stop` mid-turn, settle its own dispatch, or clear a permission-prompt indicator. A dedicated endpoint is reachable only by the hook runner. Two lesser unknowns also count against it — whether an `mcp_tool` hook's return value maps onto hook output fields like `terminalSequence`, and that the MCP server builds one `McpServer` per HTTP session, which per-turn hooks would churn.

**Constraints that shape the design:**

- **The server may be remote; the CLI runs on the daemon host.** This rules out `--settings <path>` — a settings file would have to be written on the daemon, requiring a new WS message. Inline JSON rides the existing command string, already built server-side and sent to the daemon verbatim. Inline is not the lazy option, it is the only one that respects the boundary.
- **The hook URL must be reachable from the CLI's host.** `mcpOrigin` already carries exactly this property, including from inside devcontainers and coder workspaces (the latter via `coder ssh`'s reverse port). Reusing the origin inherits the guarantee rather than re-solving it.
- **`<sessionId>` is the bearer token, and the server is not bound to localhost.** `web/server.ts` calls `server.listen(port)` with no host, so it listens on all interfaces — which is what makes `mcpOrigin` reachable from devcontainers and coder workspaces in the first place. `/hooks/<sessionId>` inherits exactly `/mcp/<sessionId>`'s model: an unguessable UUID in the path, reachable wherever the MCP endpoint is. No *weaker* than what ships today, but three deltas are new and are handled in TG1 and TG4 rather than waved off: the body is unbounded agent output (FR-TG1.12), an unknown-session probe returns `200 {}` and would otherwise grow a log-dedup map (FR-TG1.12), and hook-supplied text reaches another session's PTY through dispatch settlement (FR-TG4.7).
- **`hasSessionEndpoint()` matches `/mcp/<sessionId>` in the stored command string.** A settings blob does not break it, but it makes `meta.command` substantially longer, and that string is persisted to SQLite and shown in session-list surfaces. Accepted tradeoff, measured in TG1.
- **Titles currently require a browser.** `meta.lastTitle` is documented as browser-reported. Agent-spawned terminals have no browser attached, so they never record a title and their session-history resume summary stays empty — a gap TG2 task 4 closes by deriving the title server-side from the hook channel.
- **`--resume` deliberately drops context.** `buildCommand` re-issues only runtime grants (dirs, MCP, permissions), so a resumed session's Engy context is frozen at first spawn. TG5 closes this.

**Previous milestones:** M9 shipped async agents and the dispatch/worker model; M12 the software factory; M13 (draft) adds voice input. The one file both milestones touch is `common/src/ws/protocol.ts` — M13 adds voice message types, M14 task TG2.3 adds a branch-changed message. Coordinate if both are in flight.

## Task Group Sequencing

- **TG1: Hook transport (gated)** — no dependencies. Can start immediately. Deliberately minimal: endpoint, settings flag, reachability proof. **Ends in an explicit go/no-go decision.**
- **TG2: Terminal identity — title, branch, and attention** — **the milestone's priority.** Tasks 1–3 depend only on TG1 task 1 (types-only) and can run concurrently with the rest of TG1; tasks 4–5 need the full transport.
- **TG3: Activity truth** — depends on TG1 (full transport).
- **TG4: Dispatch auto-settle + failure surfacing** — depends on TG1 only; `isDeliverable` gates on `activityState`, which predates this milestone. Sequenced after TG3 by choice, so the `Stop` handler ordering rule is exercised with both handlers present.
- **TG5: Live session context on SessionStart** — depends on TG1 (full transport).
- **TG6: Memory capture at compaction and session end** — depends on TG1. Opens with a spike; may be dropped.
- **TG7: Worktree lifecycle visibility** — depends on TG1. Smallest and lowest value; drop first if the milestone runs long.

**Everything depends on TG1 task 1** (the `TerminalSessionMeta` field surface), which is types-only and gate-independent. TG2 tasks 1–3 need nothing else.

Once TG1's gate passes, TG2 tasks 4–5, TG3, TG4, TG5, TG6 and TG7 all add handler modules under `web/src/server/hooks/` and are independent **there**. They are not independent everywhere — three shared files still force serialization, and the per-task notes say so:

| File | Claimed by |
|---|---|
| `web/src/server/ws/terminal-session-list.ts` | TG2 t4, TG2 t5, TG3 t2, TG4 t3, TG7 t1 |
| `web/src/components/terminal/terminal-manager.tsx` | TG2 t2, TG2 t5, TG3 t2 |
| `web/src/components/terminal/session-to-tab.ts` + `types.ts` | TG2 t2, TG2 t4, TG3 t2 |

Never put two tasks from that table in the same parallel wave. `web/src/server/trpc/context.ts` is deliberately absent: hoisting every field into TG1 task 1 is what keeps it off this list.

If TG1's gate fails, TG1 task 1 and TG2 tasks 1–3 survive and the milestone closes.

## TG1: Hook Transport (gated)

The thinnest slice that answers "does a hook POST from a spawned Claude reliably reach Engy, in the execution modes I actually use?" Delivers the shared meta fields, the endpoint, the event router, the settings flag, and a reachability measurement. **No consumers** — TG2 is the first one.

**Task 1 is a types-only change with no hook dependency**, deliberately hoisted here so every later task group has its `TerminalSessionMeta` fields already declared. `web/src/server/trpc/context.ts` is otherwise touched by seven tasks across five task groups, which would serialize almost the whole milestone on one file. TG2 tasks 2–3 depend on this task alone, not on the gate.

**Explicitly out of scope for TG1, even if tempting:** any activity-state change, touching the daemon or browser trackers, dispatch settlement, titles, context injection, memory capture, any UI.

### Requirements

1. The system shall accept `POST /hooks/<sessionId>` with a Claude Code hook payload and respond `200` with a JSON hook result. *(inferred: mirrors `/mcp/<sessionId>` addressing and the existing rename route's shape)* (FR-TG1.1)
2. The system shall dispatch each hook payload to **every** handler registered for its `hook_event_name`, in a deterministic order, and shall log an event with no registered handler without failing the response. *(inferred: four modules register `Stop` and three register `UserPromptSubmit`; a one-handler-per-event map cannot express the milestone's own task layout)* (FR-TG1.2)
3. The system shall merge the results of multiple handlers for one event into a single hook response by a stated rule. *(inferred: `title.ts` returns `terminalSequence` while its co-registrants return nothing, so "last writer wins" would silently drop the only meaningful field)* (FR-TG1.11)
4. The system shall build the hook configuration as inline JSON passed to `claude --settings`, derived from the session's existing `mcpUrl` so no additional call site supplies a hook URL. *(inferred: `getMcpUrl()` has 11 browser call sites; the server may be remote so a settings file is unavailable; `terminal_spawn` already derives its MCP origin by regexing the caller's command)* (FR-TG1.3)
5. The system shall register hooks only for the `claude` agent type, leaving the `codex` command unchanged. *(inferred: Codex has no hook system)* (FR-TG1.4)
6. Hook registration shall behave correctly at all three `terminalSessionMeta` production sites — browser spawn, restart-adoption, and `spawnAgentTerminal`. *(inferred: recorded convention — the three sites do not treat `__ENGY_SESSION__` identically)* (FR-TG1.5)
7. The system shall record on the session that it has received hook events, and shall persist that record, so later task groups can prefer hook truth over inference across a restart. *(inferred: TG3's override rule and TG2's title ownership both need to know; meta is only persisted when something calls `persistTerminalSession`)* (FR-TG1.6)
8. The system shall respond `200` with an empty result for a session id absent from `terminalSessionMeta`, logging rather than erroring. *(inferred: `pnpm cycle-web` restarts the server under live sessions by design, and a non-2xx per turn surfaces a visible error in the user's terminal every turn)* (FR-TG1.7)
9. Every registered hook shall carry an explicit timeout well below the CLI's 600-second default. *(inferred: a hung POST to an unreachable server would otherwise stall the end of a turn for ten minutes)* (FR-TG1.8)
10. Hooks whose response the system does not consume shall be registered `async`, so a slow or absent endpoint stays off the turn's critical path. *(inferred: only `SessionStart` context and the title/attention `terminalSequence` are read back)* (FR-TG1.9)
11. Hook configuration shall be per-session and inline, and shall not be installed into `plugins/engy` or any settings file on disk. *(inferred: the Engy plugin is enabled user-wide, so plugin-level hooks would fire in every Claude session on the machine — this is what makes an opt-out env var unnecessary)* (FR-TG1.10)
12. The endpoint shall bound request body size and shall bound any per-session bookkeeping it keeps for unknown sessions. *(inferred: the server listens on all interfaces, the copied rename route reads bodies with no cap, `last_assistant_message` is unbounded agent output, and a once-per-session log keyed on a caller-supplied id is an unbounded map)* (FR-TG1.12)

### Tasks

1. **Session meta field surface in `web/`** — *types only; no hook dependency; unblocks TG2–TG7*
   - Files: `web/src/server/trpc/context.ts` [MODIFY]
   - Implements FR-TG1.6 (declaration half)
   - Declare every field this milestone adds, in one place, so no later task edits this file for a field: `hookDriven?: boolean`, `lastHookAt?: number` (TG1), `renamedLabel?: string` (TG2), `needsAttention?: boolean` (TG2), `lastFailure?: { type: string; message: string; at: number }` (TG4), `activeSubagents?: number` (TG4), `cliWorktrees?: string[]` (TG7) on `TerminalSessionMeta`; and `settledBy?: 'reply' | 'hook'` on `DispatchEntry`, which lives in this same file. All optional, so declaring a field whose task group is later dropped costs nothing.
   - **No DB migration is required.** `terminal_sessions.meta` is a JSON blob owned by the server (`web/src/server/db/schema.ts`), `DispatchEntry` is in-memory only, and no `terminal_session_history` column changes. Stated explicitly because `web/src/server/db/CLAUDE.md` would otherwise send a reader looking for one.
   - Verify: `cd web && pnpm blt` — types compile and nothing else changes behaviour.

2. **Hook endpoint and multi-handler event router in `web/`** (depends on task 1)
   - Files: `web/src/server/hooks/index.ts` [NEW], `web/src/server/hooks/types.ts` [NEW], `web/src/server/hooks/index.test.ts` [NEW], `web/server.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.2, FR-TG1.11, FR-TG1.6 (runtime half), FR-TG1.7, FR-TG1.12
   - `hooks/index.ts` exports `isHookPath(pathname)` / `handleHookRequest(state, req, res)` following the `isMcpPath` convention; mount in `web/server.ts` above the `isMcpPath` short-circuit, reusing the rename route's manual body accumulation **plus a size cap the rename route lacks**.
   - **The registry is `Record<string, HookHandler[]>`, not one handler per event.** Four modules register `Stop` (TG2 title, TG3 activity, TG4 settle, TG4 failure-clear), three register `UserPromptSubmit`, two register `Notification`. Specify: registration order is the module registration order, declared in one list so it is reviewable; **TG4's settle handler must run before TG3's activity handler**, because the activity handler calls `flushDispatchInbox` on `done` and an unsettled `delivered` dispatch would otherwise make "the worker's outstanding delivered dispatch" ambiguous for the next delivery. Merge rule (FR-TG1.11): handlers return partial results, later non-empty fields override earlier ones per field, and at most one handler per event may return `terminalSequence` — assert that in a test rather than trusting convention.
   - Set and `persistTerminalSession` the `hookDriven` / `lastHookAt` fields on every accepted event (FR-TG1.6). Persistence matters: without it the override rule silently resets on every server restart.
   - An unknown session id returns `200 {}` (FR-TG1.7), not 404. Log it **at most once per session, through a bounded LRU** — the key is caller-supplied, and `POST /hooks/<random-uuid>` returns `200 {}` either way, so an unbounded set is a free memory-growth primitive (FR-TG1.12).
   - There is no established convention for adding a plain HTTP route here — `attachMCP` is the only precedent, and it is now load-bearing for a second feature. Leave a decision record covering the mount point, the token-in-path identity model, the body cap, and the ordering constraint against Next's handler.
   - Verify: `cd web && pnpm vitest run src/server/hooks/index.test.ts` — `200 {}` for an unknown session and for an unregistered event; two handlers on one event both run, in the declared order; the merge rule holds and a second `terminalSequence` producer fails the test; `hookDriven` is set **and persisted** on first event; a malformed body returns 400 rather than throwing; a body past the cap is rejected without buffering it; the unknown-session log fires once and its bookkeeping is bounded.

3. **Hook settings builder and `--settings` wiring in `web/`** (depends on task 1)
   - Files: `web/src/lib/agent-types.ts` [MODIFY], `web/src/lib/agent-types.test.ts` [MODIFY]
   - Implements FR-TG1.3, FR-TG1.4, FR-TG1.5, FR-TG1.8, FR-TG1.9, FR-TG1.10
   - Add `buildHookSettings(hookUrl): string` producing a `hooks` map of `{ type: 'http', url: hookUrl }` handlers for the events this milestone uses: `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, `Notification`, `SessionEnd`, `PreCompact`, `SubagentStart`, `SubagentStop`, `WorktreeCreate`, `WorktreeRemove`. Register each with matcher omitted (match-all) and route server-side — per-event matchers would need eleven URL variants for no gain. Emit the flag from `claudeSharedFlags()` only, deriving the URL as `mcpUrl` with its `/mcp/` segment replaced by `/hooks/`, guarded on `options.mcpUrl`. Escape via the existing `shellEscape`, exactly as `claudeMcpFlag` does. Both the fresh-spawn and `--resume` branches already call `claudeSharedFlags`, so resume inherits hooks for free — the seam TG5 depends on.
   - Give every handler an explicit `timeout` (FR-TG1.8) — a few seconds, not the 600-second default. Mark every handler `async: true` **except** the three whose response is consumed: `SessionStart` (returns `additionalContext`), `Stop` and `Notification` (return `terminalSequence` for TG2). Those three keep short synchronous timeouts (FR-TG1.9).
   - This is the only place hook config is produced. It must stay inline and per-session — no writes to `plugins/engy/hooks/hooks.json`, `.claude/settings.json`, or `~/.claude/settings.json` (FR-TG1.10). The plugin is enabled user-wide, so a hook placed there would fire in every Claude session on the machine, including ones Engy did not spawn.
   - Registering all eleven now, with handlers arriving per TG, is deliberate: adding an event later would change every live session's command string and force a respawn to take effect. Unregistered events cost one 200-and-log round trip each (FR-TG1.2).
   - Deriving the URL rather than adding an option is what satisfies FR-TG1.5: all three production sites already supply `mcpUrl`, restart-adoption by replaying the stored command verbatim, so none needs to learn about hooks.
   - Verify: `cd web && pnpm vitest run src/lib/agent-types.test.ts` — the flag appears for `claude` with `mcpUrl` set, is absent without it, is absent for `codex`, appears on the `--resume` branch, survives `MCP_SESSION_PLACEHOLDER` substitution, every handler carries a timeout, and exactly the three response-consuming handlers are synchronous. **Cover FR-TG1.5 with a test, not by reading**: assert that a command replayed verbatim through the restart-adoption path still contains the hook URL and still satisfies `hasSessionEndpoint`'s `/mcp/<sessionId>` substring check.

4. **Reachability and ordering measurement** (depends on tasks 2–3)
   - Files: none (verification task; findings recorded in this document's Completion Summary)
   - Implements FR-TG1.1 (host / devcontainer / coder coverage)
   - Run `pnpm dev`, spawn a Claude terminal in each configured mode, confirm hook POSTs arrive. Host is the baseline. Devcontainer and coder must resolve `mcpOrigin` from inside the sandbox — the MCP endpoint already does, so a failure means the hook URL diverged, not that the origin is unreachable. Measure and record: lag between the visible end of a turn and the `Stop` POST; whether trailing PTY output arrives after it (this is the evidence TG3's override rule needs); and the resulting `meta.command` length with the settings blob attached.
   - **Confirm the `Notification` payload actually carries its type.** The documented matcher values (`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`) are matcher-side; FR-TG2.8 and FR-TG3.1 both route on a `notification_type` field in the POST body, and the whole "match-all, route server-side" decision in task 3 rests on it. If the field is absent, task 3 must fall back to per-type matchers with distinct URLs — a real design change, cheap now and expensive later.
   - Also confirm a hand-run `claude` in a plain terminal registers no hooks at all, and take one turn across a `pnpm cycle-web` to see what a dropped hook actually looks like in the scrollback. The point is not that outages are common — with the server down the browser cannot reach the PTY either — but that the measured `Stop` lag and the drop behaviour are what size TG3's trust window.

**Parallelizable:** task 1 must land first (both others depend on its fields). Tasks 2 and 3 then run concurrently. Task 4 needs both.

### Gate

Stop and evaluate before TG3–TG7 (TG2 tasks 1–3 proceed regardless, needing only TG1 task 1):

- Do hooks fire reliably in the execution modes you actually use? Coder mode is the one at risk.
- Does the `Notification` payload carry its type? If not, the settings builder needs per-type URLs.
- Is the `Stop` lag small enough that a title or badge driven by it feels immediate?
- Does trailing PTY output actually arrive after `Stop`? If not, TG3's override rule can be deleted rather than tuned. If it does, the measured lag sizes TG3's trust window.
- Does a mid-turn server restart leave anything visibly broken in the scrollback? Expected cost is one stray error line and one missed update — confirm it is not worse.
- Does the `--settings` blob make `meta.command` unpleasant anywhere it is displayed?

**Proceed only on an explicit yes.** Record the decision here either way.

### Completion Summary

Measured against `claude` 2.1.251 on 2026-08-29, by pointing all eleven events at a capture server and running both a headless (`-p`) and an interactive (node-pty) session. Raw captures and the probe scripts are outside the repo, in the session scratchpad.

**Verdict: proceed.** The transport works. Three plan assumptions were wrong and are corrected below; one gate question remains open and is designed around rather than answered.

**Confirmed payload fields** (these are what the later task groups may rely on):

| Event | Fields beyond the common set |
|---|---|
| `UserPromptSubmit` | `prompt`, `prompt_id`, `permission_mode` |
| `Stop` | `last_assistant_message`, `prompt_id`, `stop_hook_active`, `effort`, `background_tasks`, `session_crons` |
| `SubagentStop` | all of `Stop`, plus `agent_id`, `agent_type`, `agent_transcript_path` |
| `SessionEnd` | `reason` (observed `other`; matchers are `clear`, `resume`, `logout`, `prompt_input_exit`, `other`) |

The common set is `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`.

**Corrections to the plan, all load-bearing:**

1. **`async` does not exist for `http` hooks.** It is a `command`-hook field only; the CLI's dispatcher always awaits an http handler. FR-TG1.9 is not implementable and was dropped. Every handler therefore sits in the turn's critical path, bounded only by `timeout` — which makes FR-TG1.8 the only thing standing between a slow endpoint and a stalled turn. All eleven events carry `timeout: 5` (seconds).
2. **`SessionStart` silently discards `http` hooks.** The CLI filters `type: 'http'` out of `SessionStart` and `Setup` before dispatch, logging `Skipping HTTP hook <url> — HTTP hooks are not supported for SessionStart`. This is why no `SessionStart` POST was ever captured. **TG5 cannot work as designed.** The registration is kept (harmless, and keeps the command string stable), but TG5 needs a different transport. **Confirmed by probe:** the same `SessionStart` registered as a `command` hook fires normally and delivers `{session_id, transcript_path, cwd, hook_event_name, source, model}` on stdin, where `source` is the matcher value (`startup` observed). So the route is a `command` hook that curls `/hooks/<sessionId>` and prints the JSON response, which the CLI host can reach by construction.
3. **`Stop` and `UserPromptSubmit` can fire inside a subagent**, distinguished only by the presence of `agent_id`. Any handler that mutates *session*-level state must ignore payloads carrying `agent_id` — otherwise a subagent finishing marks the parent session `done`, and settles the parent's outstanding dispatch with the subagent's last message. Not anticipated by the plan; now a standing rule for TG3 and TG4.

**`prompt_id` resolves FR-TG4.1 cleanly.** `Stop` carries the same `prompt_id` as the `UserPromptSubmit` that opened the turn, so "settle only the turn that carried the dispatch" is an id comparison rather than the ordering heuristic the plan proposed.

**Open: the `Notification` payload was never captured.** Headless auto-denies rather than prompting, and the interactive probe did not reach a permission prompt. So whether the body carries a `notification_type` field is still unknown — the one gate question the plan flagged as potentially forcing a redesign. Rather than guess, `Notification` is registered with **per-type matchers at distinct URLs** (the type rides a query parameter the server reads), which is correct whether or not the field exists. Cost is a few extra entries in the settings blob. If a later capture shows the field present, the registration can collapse back to match-all.

**Not measured, and needs a human:** devcontainer and coder reachability, `Stop` lag against visible end-of-turn, whether trailing PTY output lands after `Stop` (this is the evidence FR-TG3.2's trust window is meant to be sized from), and whether the `--settings` blob makes `meta.command` unpleasant in the session-list UI. The blob adds **+1231 characters** (206 → 1437 on a representative fresh spawn); `hasSessionEndpoint()`'s `/mcp/<sessionId>` match is unaffected, covered by a test. Because the trailing-output question is unanswered, FR-TG3.2's window was implemented rather than deleted, sized from the daemon's 3 s `ACTIVITY_DEBOUNCE_MS`.
## TG2: Terminal Identity — Title, Branch, and Attention

**The milestone's priority.** Makes a terminal identifiable at a glance and makes "this one needs you" visible without clicking into it.

Engy and the CLI each hold half the answer. Engy knows the project, worktree branch, and scope label; the CLI knows what it is doing right now and whether it is blocked. The label block shows both, in a fixed precedence:

```
┌──────────────────────────────────┐
│ ▪ Wiring hook endpoint into…     │  ← manual rename, else agent title, else scope
│   aadamovic/m14-hooks            │  ← live branch
└──────────────────────────────────┘
  hover: initial · web — ~/dev/Engy    ← original scope + cwd
```

**Main line = `renamedLabel ?? oscTitle ?? scopeLabel`.** A manual rename always wins; otherwise the agent's own title; otherwise the scope name as today. **Sub line = the branch.** The original scope label moves to the tooltip, which already shows it; the working directory line is new.

`TerminalSessionLabel` already renders two lines — main `scopeLabel`, sub `oscTitle` in muted mono — so for its consumers this is a precedence and content change, not new chrome. **But the dock tab does not use it.** `terminal-dock-tab.tsx` builds its own `labelSpan` (collapsed label + `oscTitle`) and its own `TooltipContent`; `TerminalSessionLabel` is rendered only by `terminal-rail.tsx` and `terminal-dock-actions.tsx`. So the precedence and the branch sub-line must be implemented **twice**, and the component's own header comment ("Rendered by the dock tab…") is stale drift to fix in passing. The tooltip today shows `scopeLabel` and `oscTitle` and **no working directory** — the cwd line in the sketch above is new chrome, not existing.

**Two gaps make the naive version wrong, and both are fixable without hooks:**

- **`worktreeBranch` goes stale.** It is set once from a URL param at spawn (`terminal-server.ts` reads `params.get('worktreeBranch')`) and never updated. Agents create and switch branches mid-session constantly, and **no hook fires on `git checkout`** — `CwdChanged` covers directory changes only. A stale branch in a subheader is worse than no branch, so task 3 makes it live from `.git/HEAD`.
- **`oscTitle` is browser-only.** Titles are extracted browser-side by `components/terminal/parse-terminal-activity.ts` and applied by `osc-title.ts`, so a session with no browser attached has no title — exactly the agent-spawned sessions the header matters most for. Task 4 fills it server-side from the hook channel.

**Rename needs a new field.** `renameTerminal` currently overwrites `scopeLabel` in both the server meta and `tab.scope`, so there is no way to tell "the user renamed this" from "this is the default scope name" — and the precedence above needs exactly that distinction. A separate `renamedLabel` also preserves the original scope for the tooltip, which a boolean flag would destroy.

**Three levers for the title itself, ordered by robustness:**

| Lever | Needs hooks | Fights the CLI |
|---|---|---|
| `--name` at spawn — static project/scope identity | no | no (supported feature) |
| Server-side `lastTitle` from `Stop` — Engy's own surfaces | yes | no (never touches the PTY) |
| `terminalSequence` OSC-0 emission — the user's own terminal chrome | yes | **yes** |

The third is the fragile one: no settings key controls what the CLI writes to the title, so an emitted title can be overwritten by the CLI's next write. Task 5 measures that fight before committing to it.

### Requirements

1. The label block shall render the manual rename if set, otherwise the agent-derived title, otherwise the scope label, as its main line. *(source: user request)* (FR-TG2.1)
2. The label block shall render the session's current branch as its sub line, and shall render no sub line when the branch is unknown. *(source: user request)* (FR-TG2.2)
3. The system shall record a manual rename separately from the scope label, so the two remain distinguishable and the original scope stays available to the tooltip. *(inferred: `renameTerminal` overwrites `scopeLabel` today, which makes FR-TG2.1's precedence unexpressible)* (FR-TG2.3)
4. The system shall keep a session's recorded branch current as the branch changes during the session. *(inferred: `worktreeBranch` is captured once at spawn from a URL param, and no hook event fires on `git checkout`)* (FR-TG2.4)
5. The system shall pass a display name to `claude --name` composed from the session's project and scope, so the CLI's own prompt box and `/resume` picker identify the session. *(source: user request; supported by a documented CLI flag)* (FR-TG2.5)
6. On `Stop` the system shall derive and store a title for the session without requiring a browser to be attached. *(inferred: `oscTitle` is scraped browser-side, so agent-spawned sessions with no browser have no title at all)* (FR-TG2.6)
7. Titles shall pass through `sanitizeOscTitle` before being persisted, whatever their source. *(inferred: the sanitizer exists for a terminal-emulator CVE class, and agent output is not trusted input)* (FR-TG2.7)
8. On `Notification` matching `permission_prompt`, `agent_needs_input` or `elicitation_dialog` the system shall mark the session as needing attention, and shall clear that mark on the next `Stop` or `UserPromptSubmit`. *(source: user request)* (FR-TG2.8)
9. The browser terminal shall render the attention mark as a per-tab indicator distinct from the existing activity badge. *(source: user request)* (FR-TG2.9)
10. The system shall emit an OSC 9;4 progress state alongside the attention mark, so terminals that understand it show the same signal in their own chrome. *(source: user request; native in Windows Terminal, ConEmu, WezTerm, Ghostty)* (FR-TG2.10)

### Tasks

1. **Session display name via `--name` in `web/`** — *no dependency on TG1*
   - Files: `web/src/lib/agent-types.ts` [MODIFY], `web/src/lib/agent-types.test.ts` [MODIFY], `web/src/server/terminal-dispatch.ts` [MODIFY], `web/src/server/ws/terminal-server.ts` [MODIFY]
   - Implements FR-TG2.5
   - Add a `displayName?: string` option to `BuildAgentCommandOptions` and emit `--name '<escaped>'` from the claude builder on both the fresh-spawn and `--resume` branches. Prefer `<projectSlug> · <scopeLabel>`, falling back to the scope label alone for workspace-scoped terminals.
   - **Inject the name server-side, not at the browser call sites.** `buildAgentCommand` is called from 11 places (`use-terminal-scope.ts`, `components/terminal/types.ts`, `app/w/[workspace]/layout.tsx`, `use-quick-action.ts`, `spawnAgentTerminal`), and threading a name through all of them is the wrong trade. The terminal server already post-processes the incoming command (`replaceAll(MCP_SESSION_PLACEHOLDER, sessionId)`) and already parses `scopeLabel` / `projectSlug` / `worktreeBranch` from the connect params, so it can append the flag there for the browser path; `spawnAgentTerminal` composes it directly from `callerMeta` plus `opts.description`.
   - Files note: this makes `web/src/server/ws/terminal-server.ts` part of this task.
   - Note: shares `agent-types.ts` with TG1 task 3 and `terminal-server.ts` with TG2 task 4. Whichever lands second rebases; do not run them in the same parallel wave.
   - Verify: `cd web && pnpm vitest run src/lib/agent-types.test.ts` — the flag appears with a composed name, is escaped, is omitted when no name is supplied, and appears on the `--resume` branch. Then manually: spawn a terminal, confirm the name shows in the CLI prompt box and in `claude --resume`'s picker.

2. **Label precedence and branch subheader in `web/`** — *no dependency on TG1*
   - Files: `web/server.ts` [MODIFY], `web/src/server/ws/terminal-session-list.ts` [MODIFY], `web/src/components/terminal/session-to-tab.ts` [MODIFY], `web/src/components/terminal/types.ts` [MODIFY], `web/src/components/terminal/terminal-session-label.tsx` [MODIFY], `web/src/components/terminal/terminal-dock-tab.tsx` [MODIFY], `web/src/components/terminal/terminal-manager.tsx` [MODIFY], `web/src/components/terminal/terminal-session-label.test.ts` [NEW], `web/src/components/terminal/session-to-tab.test.ts` [MODIFY]
   - Implements FR-TG2.1, FR-TG2.2, FR-TG2.3
   - Use the `renamedLabel` field declared in TG1 task 1, and add it to `TerminalTab.scope`. Point the rename route (`POST /api/terminal/sessions/rename`) and `updateTabLabel` at it instead of `scopeLabel`, leaving `scopeLabel` as the immutable scope identity.
   - **Two pre-existing bugs ride along, fix both here.** The rename route never calls `persistTerminalSession`, so renames are lost on every server restart today — re-pointing the route without adding persistence would ship a new field with the same defect. And sessions renamed *before* this milestone have the rename baked into `scopeLabel`; under the new precedence those become "immutable scope identity" and lose the main line to any agent title. Decide and state one: migrate `scopeLabel` into `renamedLabel` on load for sessions whose label differs from their derived scope, or accept that pre-M14 renames revert. Surface `renamedLabel` through `listTerminalSessions` and `sessionToTab` alongside the existing `worktreeBranch`, which already reaches `TerminalTab.scope` and needs no plumbing. In `TerminalSessionLabel`, make the main line `renamedLabel ?? oscTitle ?? scopeLabel` and the sub line `worktreeBranch` (omitted when unset), and keep `scopeLabel` in the dock tab's tooltip and add the working directory beside it. The dock tab's rename input should seed from `renamedLabel ?? scopeLabel`.
   - The dropdown and rail hover render `TerminalSessionLabel` and inherit the change; the dock tab has a parallel implementation and does not. Extract the precedence into one shared helper both call, or the two will drift.
   - Note: shares `terminal-manager.tsx` with task 5 and with TG3 task 2. Serialize.
   - Verify: `cd web && pnpm vitest run src/components/terminal/terminal-session-label.test.ts src/components/terminal/session-to-tab.test.ts` — precedence holds for all four combinations of rename/oscTitle present; no sub line renders without a branch; a rename leaves `scopeLabel` intact and the tooltip still shows it. Then `pnpm exec playwright-cli` on the dock tab, dropdown, and rail hover.

3. **Live branch tracking in `client/`** — *no dependency on TG1*
   - Files: `client/src/watcher.ts` [MODIFY] or `client/src/git/branch-watch.ts` [NEW], `client/src/git/branch-watch.test.ts` [NEW], `common/src/ws/protocol.ts` [MODIFY], `web/src/server/ws/server.ts` [MODIFY]
   - Implements FR-TG2.4
   - Watch the repo's `HEAD` for each session's working directory with the existing chokidar setup and push a branch-changed message to the server, which updates `meta.worktreeBranch`, persists, and broadcasts so the sub line follows a `git checkout` live. **In a worktree `.git` is a file containing `gitdir: <path>`, not a directory** — resolve it before choosing the watch target, or the watch silently never fires, which is the failure mode most likely to ship unnoticed. Note `SpecWatcher` defaults to polling at 1 s (`DEFAULT_USE_POLLING`, a deliberate macOS workaround for node-pty interference) — reuse that setting rather than opting into FSEvents for this watch.
   - Prefer one watch per distinct repo root over one per session; several sessions commonly share a working directory.
   - Verify: `cd client && pnpm vitest run src/git/branch-watch.test.ts` — against a real temp repo, a `git checkout -b` fires exactly one change with the new branch; a plain-repo `.git` directory and a worktree `.git` file both resolve; a commit that does not move the branch fires nothing. Then `cd web && pnpm vitest run src/server/ws/server.test.ts` for the server half — the new message updates `meta.worktreeBranch`, persists, and broadcasts. The daemon test alone leaves half this FR unverified.

4. **Server-derived title from the hook channel in `web/`** (depends on TG1 tasks 2–3)
   - Files: `web/src/server/hooks/title.ts` [NEW], `web/src/server/hooks/title.test.ts` [NEW], `web/src/server/ws/terminal-session-list.ts` [MODIFY], `web/src/components/terminal/session-to-tab.ts` [MODIFY], `web/src/components/terminal/types.ts` [MODIFY]
   - Implements FR-TG2.6, FR-TG2.7
   - Register a `Stop` handler that derives a short title from `last_assistant_message`, sanitizes it via `sanitizeOscTitle`, sets `meta.lastTitle`, and calls `updateSessionSummary(meta.resumedFrom ?? sessionId, title)` — imported directly from `terminal-session-history.ts`, so this task does **not** edit `terminal-server.ts` and does not collide with TG3. **The browser has no path to `lastTitle` today** — `tab.oscTitle` exists only via browser-side PTY parsing, and neither `SessionListItem` nor `sessionToTab` carries a title. Surface `lastTitle` through `listTerminalSessions` and `sessionToTab` (seeding `tab.oscTitle`), and broadcast a session change so an attached browser updates live. Without this the FR's stated motivation — a session that was never attached — still shows nothing.
   - Deriving from `last_assistant_message` is the recommended route because the hook payload already carries it. The alternative — having the daemon parse OSC titles off the PTY and forward them — is more faithful to what the CLI displays but reverses a deliberate decision (`client/src/terminal/activity-parse.ts` scans OSC sequences but does **not** extract titles) and adds relay traffic. If the derived titles read poorly in practice, that alternative is the fallback; record which was chosen.
   - Setting `lastTitle` server-side also feeds the existing reconnect replay (`FR-TERMINAL-420` sends `lastTitle` to pending browsers right after the snapshot, which carries no title). The browser's `{t:'title'}` echo is already idempotent — the existing handler skips a title equal to `meta.lastTitle` — so cover that with a test rather than adding a marker.
   - Verify: `cd web && pnpm vitest run src/server/hooks/title.test.ts` — a `Stop` hook sets `lastTitle` and the history summary with no browser attached; a control character in `last_assistant_message` is stripped; a very long message is truncated at a code-point boundary; a browser echo of the derived title is a no-op.

5. **Attention mark, OSC 9;4, and the tab indicator** (depends on tasks 2 and 4)
   - Files: `web/src/server/hooks/title.ts` [MODIFY], `web/src/components/terminal/parse-terminal-activity.ts` [MODIFY], `web/src/components/terminal/parse-terminal-activity.test.ts` [MODIFY], `web/src/components/terminal/terminal-manager.tsx` [MODIFY], `web/src/components/terminal/terminal-session-label.tsx` [MODIFY], `web/src/server/ws/terminal-session-list.ts` [MODIFY]
   - Implements FR-TG2.8, FR-TG2.9, FR-TG2.10
   - Set the `needsAttention` field declared in TG1 task 1 on the matching `Notification` types, and clear it on `Stop`, on `UserPromptSubmit`, **and on the browser focus `{t:'ack'}`**. Answering a permission prompt resumes the same turn, so neither `Stop` nor `UserPromptSubmit` fires — without the ack path the indicator stays lit for the rest of a turn you already attended to. `FR-TERMINAL-240`'s ack already clears `activityState`; clear this field alongside it. Broadcast it and surface it in `listTerminalSessions` — this is the path that works with no browser attached and is what the indicator should read. Separately return `terminalSequence` emitting `ESC ] 9 ; 4 ; 4 ; 0 BEL` on attention and `ESC ] 9 ; 4 ; 0 ; 0 BEL` on clear, for the user's own terminal chrome. Extend the browser parser to recognise the `9;4` OSC prefix alongside the OSC 0/2 title it already extracts — it walks OSC sequences as raw strings before xterm sees them, which is simpler than registering an xterm OSC handler and matches the existing pattern. Keep the daemon copy in `client/src/terminal/activity-parse.ts` unchanged.
   - **Before measuring the title fight, check for an off switch.** An env var of the form `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` is reported to suppress the CLI's own title writes. It is **not** in the settings reference and I could not confirm it — but Engy controls the spawn environment (`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is already set in every PTY and runner spawn), so if it works it resolves this task's central risk for one line. Test it first; only fall through to measurement if it does nothing.
   - **Measure the title fight before trusting the OSC path.** With task 4 live, watch whether the CLI overwrites Engy's emitted OSC-0 title mid-turn and how quickly. If it does, drop the OSC-0 emission rather than fighting it — the value then sits entirely in `--name`, the server-side `lastTitle`, and the label precedence, none of which touch the PTY. The 9;4 emission is unaffected either way; the CLI does not write progress sequences.
   - Verify: `cd web && pnpm vitest run src/components/terminal/parse-terminal-activity.test.ts src/server/hooks/title.test.ts` — 9;4 states parse; a 9;4 sequence split across two chunks parses via the existing `pending` tail; an OSC 0 title still parses unchanged; attention sets and clears on the right events. Then manually: trigger a permission prompt in a background terminal and confirm the indicator lights before you look at the terminal.

**Parallelizable:** tasks 1, 2 and 3 need only TG1 task 1 and can start immediately — together they deliver the label block, the live branch, and the CLI-side name without waiting on TG1's gate. Constraints: task 1 must not share a wave with TG1 task 3 (both edit `agent-types.ts`) nor with TG2 task 4 (both edit `terminal-server.ts`); tasks 2, 4 and 5 all touch the session-list / tab plumbing and must be serialized among themselves and against TG3 task 2. Tasks 4 and 5 need the full TG1 transport.

### Completion Summary

_Blank until TG2 completes._
## TG3: Activity Truth

Replaces the bell-and-regex heuristic with exact transitions for hook-driven sessions. This is what makes dispatch gating correct, so TG4 depends on it.

### Requirements

1. On `UserPromptSubmit` the system shall set the session's activity state to `active`; on `Stop` to `done`; on `Notification` matching `permission_prompt`, `agent_needs_input` or `elicitation_dialog` to `waiting`; on `Notification` matching `idle_prompt` to `idle`. *(source: user request)* (FR-TG3.1)
2. For a session marked `hookDriven`, the system shall ignore `{t:'act'}` relay messages **only while a hook event is recent**, and shall accept relay messages again once `lastHookAt` is older than a bounded window. *(inferred: trailing PTY output would otherwise overwrite a hook-derived `done` — but an unconditional override disables all three of the heuristic's existing healing paths at once, so a single dropped `Stop` would pin the session at `active` forever)* (FR-TG3.2)
3. Hook-derived activity changes shall persist and broadcast through the same path as daemon-derived ones, so project badges, the terminal rail and dispatch gating are driven identically. *(inferred: three consumers already read this one field)* (FR-TG3.3)
4. For a hook-driven session, the browser terminal shall render the server-broadcast activity state in its tab badge instead of its locally computed one. *(inferred: per-tab badges come from a browser-local CustomEvent, not the server broadcast)* (FR-TG3.4)
5. A session whose hook channel stops producing events shall return to daemon-derived activity rather than holding its last hook-derived state. *(inferred: the recovery half of FR-TG3.2 — dispatch delivery gates on this field, so a stuck `active` silently blocks every future dispatch to that worker)* (FR-TG3.5)

### Tasks

1. **Shared activity applier and the override rule in `web/`**
   - Files: `web/src/server/hooks/activity.ts` [NEW], `web/src/server/hooks/activity.test.ts` [NEW], `web/src/server/ws/terminal-server.ts` [MODIFY]
   - Implements FR-TG3.1, FR-TG3.2, FR-TG3.3, FR-TG3.5
   - Extract the relay's inline `{t:'act'}` body into an exported `applyActivityState(state, sessionId, next, source)`. It must keep doing all four things the inline block does — set meta, `persistTerminalSession`, `broadcastTerminalActivityChange`, `flushDispatchInbox` on `idle`/`done` — and gain the override: when `source === 'relay'` and the session is hook-driven **with `lastHookAt` inside the trust window**, return without acting. Register the hook handlers to call it with `source === 'hook'`.
   - **The window is the whole point, and it is not a detail to hand-wave.** An unconditional override disables all three of the heuristic's healing paths (daemon resync `sync.activity[]`, `/ws/events` reseed, focus `ack`), so one dropped `Stop` pins the session at `active` — and `isDeliverable()` gates on that field, so every future dispatch to that worker silently queues forever. Size the window from TG1 task 4's measured `Stop` lag plus the daemon's 3 s `ACTIVITY_DEBOUNCE_MS`, not from a guess, and state the chosen value and its derivation here.
   - If TG1 task 4 measured no trailing PTY output after `Stop`, the override may be unnecessary entirely — prefer deleting it over tuning a window nothing needs. Record that outcome either way.
   - Verify: `cd web && pnpm vitest run src/server/hooks/activity.test.ts` — each of the four FR-TG3.1 mappings; a `{t:'act'}` inside the window is a no-op; a `{t:'act'}` **past** the window applies and recovers the session; a `{t:'act'}` on a non-hook session always applies; `flushDispatchInbox` fires on a hook-derived `done`; and a session that receives a `UserPromptSubmit` and then no further hooks becomes deliverable again rather than stranding queued dispatches.

2. **Browser tab badge reads server state for hook-driven sessions** (depends on task 1)
   - Files: `web/src/components/terminal/terminal-manager.tsx` [MODIFY], `web/src/hooks/use-terminal-activity.ts` [MODIFY], `web/src/components/terminal/terminal-manager.test.ts` [MODIFY], `web/src/server/ws/terminal-session-list.ts` [MODIFY], `web/src/components/terminal/session-to-tab.ts` [MODIFY], `web/src/components/terminal/types.ts` [MODIFY]
   - Implements FR-TG3.4
   - `dispatchActivityEvent` currently emits the browser tracker's own verdict. Subscribe the same `terminal:activity-changed` store to the `TERMINAL_ACTIVITY_CHANGE` event — already typed in `events-context.tsx` and already consumed by `use-project-activity.ts` — and let a server-sourced update win for hook-driven sessions. Suppress the local tracker's emission for those sessions rather than racing it. Do not delete the local tracker; non-hook sessions still need it.
   - **Nothing tells the browser a session is hook-driven.** `TerminalActivityChangePayload` is `{sessionId, projectSlug?, state?, removed?}` and `SessionListItem` has no such field, so "suppress for those sessions" is unimplementable as written. Add `hookDriven` to `SessionListItem` + `sessionToTab` + `TerminalTab.scope`, or add it to the activity payload — pick one and say which. Files below include the plumbing either way.
   - Note: shares `terminal-manager.tsx` with TG2 tasks 2 and 5. Serialize whichever lands second.
   - Verify: `cd web && pnpm vitest run src/components/terminal/terminal-manager.test.ts` — a hook-driven session's tab badge follows the broadcast and ignores local tracker output; a non-hook session is unchanged.

**Parallelizable:** none.

### Completion Summary

_Blank until TG3 completes._

## TG4: Dispatch Auto-Settle + Failure Surfacing

Removes the dispatch protocol's dependence on model cooperation, and surfaces the API-failure state Engy cannot see today.

**Feed the existing settlement machinery, do not rebuild it.** `FR-MCP-110/120/180/190` and `FR-TERMINAL-270/280/290` already define correlation-id and identity-based reply matching (oldest-`delivered`-wins), idle-gated `[engy-notice]` push of async settlements into the origin terminal with requeue on daemon drop, and a worker-death path that fails every queued and delivered dispatch. A `Stop` hook is a new *trigger* for `settleDispatch`, not a new settlement path. Read those FRs before writing code.

### Requirements

1. When a `Stop` hook arrives for a worker holding a delivered, unsettled dispatch **whose delivery preceded the turn that just ended**, the system shall settle it as replied using `last_assistant_message`. *(source: user request; the turn-ordering clause is inferred — settling on any `Stop` means a user typing into the worker terminal has their unrelated turn injected into the origin agent as the dispatch reply)* (FR-TG4.1)
2. An explicit `terminal_reply` shall remain authoritative — a dispatch already settled by the agent shall not be re-settled by the subsequent `Stop` hook. *(inferred: both paths fire on a cooperating agent)* (FR-TG4.2)
3. A dispatch settled from a hook rather than an explicit reply shall record which path settled it. *(inferred: needed to tell whether the pasted reply contract still earns its place)* (FR-TG4.3)
4. On `StopFailure` the system shall record the error type on the session and hold the session out of dispatch delivery until its next `UserPromptSubmit` or `Stop`. *(source: user request — a rate-limited worker currently reads as idle and receives the next dispatch, which fails identically)* (FR-TG4.4)
5. The system shall expose a session's `StopFailure` state to agents through `terminal_status` and to the UI through the session list. *(inferred: a dispatching agent needs to know why its worker went quiet)* (FR-TG4.5)
6. `SubagentStart` and `SubagentStop` shall maintain a live subagent count on the session, exposed through the same two surfaces. *(source: user request)* (FR-TG4.6)
7. Hook-supplied text shall be stripped of control characters before it is injected into another terminal. *(inferred: `notifyOrigin` strips only the paste sentinel and slices length before pasting into the origin PTY — safe when the text came from a cooperating agent's `terminal_reply`, not when it is an HTTP body carrying agent output that may itself be prompt-injected)* (FR-TG4.7)

### Tasks

1. **Stop-hook dispatch settlement in `web/`**
   - Files: `web/src/server/hooks/dispatch.ts` [NEW], `web/src/server/hooks/dispatch.test.ts` [NEW], `web/src/server/terminal-dispatch.ts` [MODIFY]
   - Implements FR-TG4.1, FR-TG4.2, FR-TG4.3, FR-TG4.7
   - Register a `Stop` handler that finds the worker's outstanding `delivered` dispatch and calls the existing `settleDispatch` with `last_assistant_message`. Guard on status — `replied` or `failed` entries are skipped, which is what makes FR-TG4.2 hold without ordering assumptions. Use the `settledBy` field declared in TG1 task 1. Leave `replyContract` in the pasted prompt unchanged; the hook is a safety net, and the Completion Summary should report how often each path won.
   - **Do not settle on any `Stop`.** A user typing into the worker terminal ends a turn that has nothing to do with the pending dispatch, and `notifyOrigin` would paste that unrelated answer into the origin agent's PTY as the reply. Tie settlement to the turn that carried the dispatch — the simplest form is to record the `UserPromptSubmit` that follows delivery and settle only that turn's `Stop`.
   - **Sanitize before injecting** (FR-TG4.7). `notifyOrigin` strips only `PASTE_SENTINEL_RE` and slices length; that was sufficient when the text came from a cooperating agent's `terminal_reply` MCP call, and is not sufficient for an HTTP body. Strip control characters the way `sanitizeOscTitle` does before the text reaches `injectPromptToTerminal`.
   - This handler must run **before** TG3's activity handler on the same `Stop` — see TG1 task 2's ordering rule.
   - Verify: `cd web && pnpm vitest run src/server/hooks/dispatch.test.ts src/server/terminal-dispatch.test.ts` — a Stop hook settles the dispatch its own turn carried; a Stop hook for an *unrelated* turn leaves the dispatch delivered; a `terminal_reply` first makes the Stop hook a no-op; a Stop hook with no outstanding dispatch is a no-op; control characters in `last_assistant_message` never reach `injectPromptToTerminal`.

2. **`StopFailure` state and deliverability hold in `web/`** (depends on task 1)
   - Files: `web/src/server/hooks/failure.ts` [NEW], `web/src/server/hooks/failure.test.ts` [NEW], `web/src/server/terminal-dispatch.ts` [MODIFY]
   - Implements FR-TG4.4
   - Use the `lastFailure` field declared in TG1 task 1. Extend `isDeliverable()` to return false while it is set; clear on the next `UserPromptSubmit` or `Stop`. This can strand a queued dispatch indefinitely if the session never recovers — pick and document one of "clear after a fixed window" or "clear only on the next turn", and cover the chosen behaviour in a test. Depends on task 1 because both edit `terminal-dispatch.ts`.
   - Verify: `cd web && pnpm vitest run src/server/hooks/failure.test.ts` — a `rate_limit` StopFailure makes the session undeliverable; a subsequent `UserPromptSubmit` restores it; a dispatch created during the hold queues rather than delivers.

3. **Subagent counts and status exposure in `web/`** (depends on task 2)
   - Files: `web/src/server/hooks/subagent.ts` [NEW], `web/src/server/hooks/subagent.test.ts` [NEW], `web/src/server/mcp/terminal-tools.ts` [MODIFY], `web/src/server/ws/terminal-session-list.ts` [MODIFY]
   - Implements FR-TG4.5, FR-TG4.6
   - Track the `activeSubagents` field declared in TG1 task 1, incremented on `SubagentStart` and decremented on `SubagentStop`, floored at zero (a killed session can drop a stop). Surface `activeSubagents` and `lastFailure` in `terminal_status` and `listTerminalSessions`. Depends on task 2 because both extend the same dispatch/session surface, and both must be serialized against TG2 t4/t5 and TG7 on `terminal-session-list.ts`.
   - Verify: `cd web && pnpm vitest run src/server/hooks/subagent.test.ts src/server/mcp/terminal-tools.test.ts src/server/ws/terminal-session-list.test.ts` — start/stop pairs balance, an unmatched stop floors at zero, and both fields appear in `terminal_status` **and** in `listTerminalSessions`.

**Parallelizable:** none. All three share `terminal-dispatch.ts` or `context.ts` and are serialized deliberately.

### Completion Summary

_Blank until TG4 completes._

## TG5: Live Session Context on SessionStart

Replaces spawn-time-frozen context with context fetched when the session actually starts. The payoff concentrates on `--resume`, where Engy currently supplies nothing.

### Requirements

1. On `SessionStart` the system shall return `additionalContext` describing the session's workspace, project, and its in-progress and blocked tasks. *(source: user request)* (FR-TG5.1)
2. The system shall return that context for matchers `startup`, `resume`, `compact` and `fork` alike. *(inferred: `buildCommand` drops prompt and system prompt on `--resume`, so a resumed session's context is otherwise frozen at first spawn)* (FR-TG5.2)
3. When the session's meta carries no project binding, the system shall return no `additionalContext`. *(inferred: a plain workspace-scoped terminal has no task list to inject)* (FR-TG5.3)
4. The system shall bound the injected context so a large task list cannot dominate the session's opening context. *(inferred: every session pays this on every start, resume and compaction)* (FR-TG5.4)

### Tasks

1. **SessionStart context builder in `web/`**
   - Files: `web/src/server/hooks/session-context.ts` [NEW], `web/src/server/hooks/session-context.test.ts` [NEW]
   - Implements FR-TG5.1, FR-TG5.2, FR-TG5.3, FR-TG5.4
   - Resolve workspace and project from `terminalSessionMeta` (`workspaceSlug`, `projectId`, `projectSlug`, `worktreeBranch`), read tasks through the existing task query layer, and render a compact markdown block returned as `hookSpecificOutput.additionalContext`. Include in-progress tasks with their `blockedBy`; exclude `backlog` and `done`. Cap the block at a fixed character budget and say so in the block when it truncates. Return `{}` when `projectId` is unset. Ignore the matcher — the same context is correct for all four.
   - Verify: `cd web && pnpm vitest run src/server/hooks/session-context.test.ts` — context appears for a project-bound session, is empty for an unbound one, is identical across the four matchers, and truncates with a visible marker past the budget.

2. **Relevant memory inclusion** (depends on task 1)
   - Files: `web/src/server/hooks/session-context.ts` [MODIFY], `web/src/server/hooks/session-context.test.ts` [MODIFY]
   - Implements FR-TG5.1
   - Append the top few workspace memories relevant to the project via the existing `runMcpSearch` / `search/` helpers rather than a new query path. Use `mode: 'lex'` — `hybrid` can take minutes on this hardware and would stall session start behind the hook's 600 s default timeout, so a short explicit `timeout` on the SessionStart hook is required here too.
   - Verify: `cd web && pnpm vitest run src/server/hooks/session-context.test.ts` — memories appear, the combined block still respects the FR-TG5.4 budget, and a search failure degrades to task-only context rather than failing the hook.

**Parallelizable:** none — task 2 extends task 1's file.

### Completion Summary

Both tasks landed together in `5d8e338`; task 2 extends task 1's file, so splitting the commit would have been artificial.

**The transport changed.** The plan specified an `http` hook returning `additionalContext`. That cannot work — CLI 2.1.251 silently discards `type: "http"` hooks registered for `SessionStart` (see the TG1 Completion Summary). `SessionStart` is now registered as a `command` hook:

```
curl -s -m 5 -X POST '<hookUrl>' -H 'Content-Type: application/json' -d @-
```

It pipes the payload from stdin to the same `/hooks/<sessionId>` endpoint and prints the response. Only the `SessionStart` entry changed; the other ten stay `http`.

**A second shape difference, found by probing rather than by reading.** `SessionStart` requires the nested `{ hookSpecificOutput: { hookEventName, additionalContext } }` form. The flat `{ additionalContext }` shape that the other ten hooks use is silently ignored here — verified by two live `claude -p` runs against a capture server: the nested reply had its marker echoed back verbatim by the model, the flat reply produced no context at all. `buildSessionStartContext` therefore returns the nested shape and deliberately sits outside the shared synchronous `HookHandler` type, which is flat.

**Budget:** `SESSION_CONTEXT_CHAR_BUDGET = 4000` across the combined task and memory block, with a visible truncation marker.

**Memory search** runs through the existing `runQmdSearch` in `lex` mode behind an explicit 3 s timeout, filtered against superseded paths. Any failure or timeout degrades to task-only context rather than failing the hook — required, because this hook is on the critical path of every session start, resume, fork and compaction.

**Not verified:** devcontainer and coder reachability of the command hook. It relies on `curl` existing on the CLI host and on that host reaching the hook URL — the same reachability property `mcpOrigin` already guarantees, but the command-hook form specifically was only exercised on the host.

## TG6: Memory Capture at Compaction and Session End

`PreCompact` fires immediately before context is discarded, which is exactly when a distillation is most valuable and most likely to be lost. Today memories only escape through the runner's `TASK_COMPLETION_SCHEMA` `memories[]` field — headless only — or by the agent remembering to call `createFleetingMemory`.

**This TG opens with a spike because the delivery mechanism is genuinely unresolved.** An `http` hook can only hand Engy a `transcript_path`, and that path is on the daemon host, which a remote server cannot read. The alternatives (`type: "agent"` with Engy MCP access, or `type: "command"` invoking something that must already exist on the daemon host) each carry an unverified assumption. **Do not plan task 2 in detail until the spike settles this.**

### Requirements

1. The system shall capture a distillation of the session as fleeting memories on `PreCompact`. *(source: user request)* (FR-TG6.1)
2. The system shall do the same on `SessionEnd` for every matcher except `clear`. *(inferred: `clear` is an explicit discard by the user)* (FR-TG6.2)
3. Capture shall not block or delay the session, and a capture failure shall not fail the hook. *(inferred: `PreCompact` can block compaction on exit 2, and compaction already happens under context pressure)* (FR-TG6.3)
4. Memories created by this path shall record their origin so `review-memories` can distinguish them from agent-authored ones, using a field other than `source`. *(inferred: an automatic path produces a different volume and quality distribution; `source` is not available as the marker — `createFleetingMemory` defaults it and the `CREATE_MEMORIES_EVENT` path force-sets `'agent'` per `FR-MEMORY-250` — so origin must ride a tag)* (FR-TG6.4)
5. Capture shall respect the existing ingest limits — at most 50 memories, 10,000 characters each, unknown `type` clamped to `capture`. *(inferred: `FR-MEMORY-250` already enforces these on the headless path; a third channel must not assume it is exempt)* (FR-TG6.5)

### Tasks

1. **Spike: determine the viable capture mechanism**
   - Files: none (spike; findings recorded in this document's Completion Summary)
   - Implements FR-TG6.1 (mechanism selection)
   - Answer, by testing against the installed CLI: does a `type: "agent"` hook inherit the session's `--mcp-config`, so its prompt can call `createFleetingMemory` directly? Does it inherit the transcript, or must it be pointed at `transcript_path`? What is its latency on `PreCompact`, and does `async: true` (or `asyncRewake`) apply to it? If the agent path fails, does a `type: "http"` hook plus a daemon-side transcript read — a new WS message — cost less than it is worth? **A negative outcome is a valid result: drop TG6.**
   - Verify: a written finding in the Completion Summary naming the chosen mechanism and its evidence, or an explicit drop.

2. **Capture handler** (depends on task 1 — plan after the spike)
   - Files: `web/src/server/hooks/memory.ts` [NEW], `web/src/server/hooks/memory.test.ts` [NEW], plus whatever the spike selects
   - Implements FR-TG6.1, FR-TG6.2, FR-TG6.3, FR-TG6.4, FR-TG6.5
   - Reuse the `engy:session-distill` skill's extraction criteria rather than inventing a second standard for what is worth remembering. Write through the same path `createFleetingMemory` uses so the review queue sees no difference beyond the origin tag. Register the hook `async` so FR-TG6.3 holds structurally rather than by timeout tuning. This becomes the **third** capture channel — headless `structured_output.memories[]` and manual `createFleetingMemory` both stay — so it must not assume the other two will be retired.
   - Verify: to be defined by the spike.

**Parallelizable:** none.

### Completion Summary

**Spike verdict: proceed, but not with `type: "agent"`.** Use a `command` hook that detaches a nested `claude -p`. Everything below was tested against CLI 2.1.251, not read from docs.

**`type: "agent"` hooks do inherit the parent's MCP servers — proven, and then ruled out anyway.** An agent hook registered on `Stop` with an `--mcp-config` did reach a probe MCP tool and call it (`Tool 'probe_record_memory' completed successfully in 8ms`). So the mechanism can do what TG6 wants. It is gated off both events TG6 needs:

- `SessionEnd` → `Agent stop hooks are not yet supported outside REPL`, in headless *and* in a real PTY. A lifecycle limit, not an interactivity one.
- `PreCompact` → silently never fires. No log, no error. A `command` hook on the same event fired normally, so this is the same silent-drop pattern TG1 found for `SessionStart`.

An agent hook also does **not** inherit the transcript. Each firing is a brand-new isolated query (`Starting agent query with 1 messages`) handed `transcript_path` as text to read itself — no shortcut. It blocks rather than running async.

**The working route.** A `command` hook reads `transcript_path` from stdin, detaches a nested `claude -p` with `nohup … & disown`, and returns `{}` immediately. Validated end-to-end on both events: `PreCompact` returned well inside a 5 s timeout while the background job ran 18.5 s and recorded a real distillation; `SessionEnd` the same at 15.7 s. **The background job survived the parent PTY being killed** — the property that matters most, since on `SessionEnd` the parent is exiting by definition. Detach explicitly; do not rely on the hook framework to keep an orphan alive.

This makes FR-TG6.3 structural rather than timeout-tuned: the parent never waits on the distillation at all.

**Two payload fields TG1 missed**, because TG1 never provoked a real `/compact`: `PreCompact` carries `trigger` (`manual` observed) and `custom_instructions` (`null` observed) alongside the common set. `SessionEnd`'s `reason` was observed as `other` (headless exit) and `prompt_input_exit` (interactive `/exit`) — never `clear`, consistent with FR-TG6.2's target set.

**FR-TG6.5 needs no new work.** The nested call reaches `createFleetingMemory` through the same server path as every other channel, so the existing 50-item / 10,000-char / type-clamp enforcement applies for free.

**The cost, and why the feature ships disabled by default.** Every firing is a genuine extra model call that reads the transcript. Measured **$0.34** on a near-*empty* test transcript, driven mostly by cache-read volume, and it scales with transcript size. `PreCompact` fires exactly when a transcript is at its largest. Multiplied across every compaction and every session end, on a machine that runs many agents at once, that is a real and continuous spend the user has not agreed to — and it is invisible, since the work happens in a detached background process.

So TG6 ships behind a workspace setting that is **off** by default, and the implementation caps how much transcript it feeds rather than passing it whole. Turning it on is a deliberate choice made with the cost in view. This is a departure from the plan, which assumed the capture would simply be on.

## TG7: Worktree Lifecycle Visibility

Engy's runner creates and owns worktrees at `.claude/worktrees/engy-session-<shortId>`, but a `claude --worktree` run inside an Engy terminal — or a subagent spawned with `isolation: worktree` — creates worktrees Engy never learns about. This registers them.

Nothing in the knowledge base covers CLI-managed worktrees; `combined-worktrees.design.md` is about grouping panes by `worktreeBranch`, not creation ownership. Treat this TG as opening a question rather than following a decision, and record the ownership split it lands on.

### Requirements

1. On `WorktreeCreate` the system shall record the worktree path against the session. *(source: user request)* (FR-TG7.1)
2. On `WorktreeRemove` the system shall clear that record. *(source: user request)* (FR-TG7.2)
3. The system shall always allow `WorktreeCreate` to proceed. *(inferred: the hook aborts creation on any non-zero exit, and Engy has no basis to veto a worktree the user asked for)* (FR-TG7.3)
4. CLI-created worktrees shall be distinguishable from Engy runner-managed ones. *(inferred: the runner owns cleanup of its own worktrees and must not adopt or delete someone else's)* (FR-TG7.4)

### Tasks

1. **Worktree registration in `web/`**
   - Files: `web/src/server/hooks/worktree.ts` [NEW], `web/src/server/hooks/worktree.test.ts` [NEW], `web/src/server/ws/terminal-session-list.ts` [MODIFY]
   - Implements FR-TG7.1, FR-TG7.2, FR-TG7.3, FR-TG7.4
   - Use the `cliWorktrees` field declared in TG1 task 1 — separate from anything the runner writes, which makes FR-TG7.4 structural rather than a convention. Append on create, remove on remove, always return `{}`. Surface the list in `listTerminalSessions` so the rail can show it. Do not wire this into the runner's cleanup path in this milestone.
   - Verify: `cd web && pnpm vitest run src/server/hooks/worktree.test.ts` — create appends, remove clears, a remove for an unknown path is a no-op, and the handler never returns a blocking result.

### Completion Summary

_Blank until TG7 completes._

## Out of Scope

- **Hooks for headless execution-engine (runner) sessions.** `ExecutionStartConfig` carries no MCP field and runner agents connect anonymously through user-scope `claude mcp add … /mcp`, so there is no per-session URL to derive a hook URL from. The fix path is known — add an `mcpUrl = /mcp/${sessionId}`-style field to `ExecutionStartConfig`, joining the `agent_sessions.sessionId` and terminal-token namespaces — but it is its own change and blocks nothing in M14.
- `PreToolUse` runtime permission gating and the `--dangerously-skip-permissions` re-launch guard (explicitly dropped by the user).
- `TaskCreated` / `TaskCompleted` mirroring into Engy tasks and blocking completion on FR/test-tag coverage (explicitly deferred by the user).
- `FileChanged` notifications telling a running agent its plan or spec was edited (explicitly dropped by the user).
- Hook support for Codex — no equivalent system exists.
- Unifying the three duplicated activity trackers. `@engy/common` is types-only by decision; hooks make the duplication less load-bearing but do not remove it.
- `PermissionRequest` / `PermissionDenied` handling, `PostToolUse` telemetry, `ConfigChange`, `InstructionsLoaded`, `CwdChanged`, `TeammateIdle`, `Elicitation`.
- Removing the pasted `replyContract` from dispatch delivery. TG4 makes it redundant on cooperating agents but keeps it; retiring it is a follow-up once TG4 reports how often each path wins.
