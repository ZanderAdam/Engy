# Open-source orchestrators where an agent controls coding agents

All facts were last confirmed on 2026-10-31, unless a line gives another date. Repos were read as shallow clones at these commits: gastown `466aa41` (2026-10-28), beads `6ebaacb` (2026-10-31), ruflo `bd77bce` (2026-10-31), agent-orchestrator `b7091d8` (2026-10-31), overstory `ff38f3f` (2026-05-28), metaswarm `33d39f7` (2026-06-19).

Evidence tags:
- **[CODE]** I read the mechanism in source.
- **[DOC]** A design doc in the repo says it. The doc can be stale or aspirational.
- **[ISSUE]** A reporter says it in a GitHub issue. I did not reproduce it. Some issue text is agent-written.
- **[CLAIM]** An author, a vendor or marketing says it. It is not verified.
- **[3P]** A third party says it.

Project status:

| Project | Repo now | Last push | Stars (weak evidence) | Status |
|---|---|---|---|---|
| Gas Town | gastownhall/gastown (redirect from steveyegge) | 2026-10-28 | 18.6k | Author says it "effectively burned down". 8 commits since 2026-10-01 (GitHub API). |
| Gas City | gastownhall/gascity | 2026-10-31 | 1.5k | SDK successor, active. Not read in source. |
| Beads | gastownhall/beads | 2026-10-31 | 28.3k | Active. |
| Ruflo (was claude-flow) | ruvnet/ruflo (redirect from claude-flow) | 2026-10-31 | 80.4k | Active. Large gap between claims and mechanism. |
| Agent Orchestrator | OrchestratorInc/agent-orchestrator (redirect from ComposioHQ) | 2026-10-31 | 14.0k | Active. Go daemon. README badge says Apache-2.0. |
| Overstory | jayminwest/overstory | 2026-05-28 | 1.3k | Archived. Successor is jayminwest/warren (511 stars, cloud sandboxes, not read). |
| Metaswarm | dsifry/metaswarm | 2026-06-19 | 427 | No push for 4 months. Skills and prompts, no daemon. |
| Symphony | openai/symphony | 2026-09-15 | 27.9k | Spec-first. Only SPEC.md skimmed. |

Star counts are weak evidence of use. They say nothing about whether a mechanism works. Ruflo has the most stars and the weakest worker runtime in this group.

Web search conflict: [Secondary sources](https://www.augmentcode.com/tools/open-source-agent-orchestrators) say Agent Orchestrator moved to an AgentWrapper account and is MIT. The GitHub API and README on 2026-10-31 show OrchestratorInc and an Apache-2.0 badge. I trust GitHub. I did not read the LICENSE file.

Other active projects seen, metadata only, not read: Yeachan-Heo/oh-my-claudecode, Dicklesworthstone/ntm, Dicklesworthstone/mcp_agent_mail (deprecated for a Rust rewrite), smtg-ai/claude-squad, multica-ai/multica, desplega-ai/agent-swarm, paperclipai/paperclip, BloopAI/vibe-kanban, ParadevAI/Paradev.

## How do agents share state?

### Takeaway
Serious systems keep work state in a durable store outside the agent context: Beads on Dolt (Gas Town, Metaswarm), SQLite (Overstory, Agent Orchestrator), or the issue tracker plus filesystem (Symphony). The store is the record, and messages are only wake-up signals. Beads works, but its write load strains the database at scale.

### Cited Findings
- **Beads** [CODE/DOC]: A graph issue tracker on Dolt. `bd ready` lists tasks with no open blockers. `bd update <id> --claim` atomically sets assignee and in_progress. Hash IDs such as `bd-a1b2` prevent merge collisions across branches. — [beads README](https://github.com/gastownhall/beads/blob/6ebaacb/README.md)
- Beads has two modes: embedded Dolt (default, single writer) and an external `dolt sql-server`. — [beads README](https://github.com/gastownhall/beads/blob/6ebaacb/README.md)
- Claims are real code, and each claim names its winner in the Dolt commit message. [CODE] — [claim_next.go](https://github.com/gastownhall/beads/blob/6ebaacb/internal/storage/issueops/claim_next.go)
- **Gas Town** [DOC]: Two levels of Beads. Town level (`~/gt/.beads/`, prefix `hq-`) holds cross-rig coordination, Mayor mail and agent identity. Rig level holds implementation work and merge requests. Agents themselves are beads. — [architecture.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/architecture.md)
- Gas Town mail is `type=message` beads routed by `gt mail`, with typed messages: POLECAT_DONE (Polecat to Witness), MERGE_READY (Witness to Refinery), MERGED (Refinery to Witness). [DOC] — [mail-protocol.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/mail-protocol.md)
- **Overstory** [CODE]: A custom SQLite mail store (`src/mail/store.ts`), a SQLite FIFO merge queue, and session state in sessions.json. — [merge/queue.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/merge/queue.ts), [watchdog/health.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/watchdog/health.ts)
- **Agent Orchestrator** [DOC]: SQLite with DB-trigger change-data-capture into `change_log`, fanned out to an SSE stream with `Last-Event-ID` replay. Display status is never stored. It is computed at read time from durable facts. — [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md), [STATUS.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/STATUS.md)
- **Metaswarm** [DOC]: "All task state lives in BEADS; agents coordinate via database, not messages." — [README](https://github.com/dsifry/metaswarm/blob/33d39f7/README.md)
- **Ruflo** [DOC]: Its own CLAUDE.md calls Ruflo a "coordination ledger" and says a coordination call "records work; it does not perform the implementation". Agents share memory by CLI `memory store` calls in a namespace. — [ruflo CLAUDE.md](https://github.com/ruvnet/ruflo/blob/bd77bce/CLAUDE.md)
- **Symphony** [DOC]: No persistent database. One in-memory orchestrator state. Restart recovery comes from tracker and filesystem. — [SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)
- Yegge says Beads "strains databases pretty hard", that agents burn tokens keeping beads "synced, repaired, backed up", and that his DB is "a bit cranky, what with 12,000 git commits/day". Wheelhouse uses a shared Dolt server backed by GCS. [CLAIM, Aug 2026, read through a summarizing fetch] — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)
- 32 zombie Dolt sql-server processes accumulated on one install. [ISSUE, 2026-05-10] — [gastown #3938](https://github.com/gastownhall/gastown/issues/3938)
- `dolt merge` in Dolt 2.6.0 walks the full commit graph and can report conflicts that 2.5.x resolved silently. [DOC] — [gastown CHANGELOG](https://github.com/gastownhall/gastown/blob/466aa41/CHANGELOG.md)

### Inferences
- Engy already has a SQLite store and a single server, so it does not need Dolt. The Beads ideas worth copying are the atomic claim, the "ready = no open blockers" query, and modelling agents as records.
- Agent Orchestrator's rule (store facts, derive status) avoids a whole class of stale-status bugs that Gas Town has.

### Gaps
- I did not measure Beads throughput limits. The only figure is Yegge's own.
- Gas City and Wheelhouse state design is unknown. A [search](https://vanja.io/yegge-agent-city-four-claims/) describes Wheelhouse as closed-source, and I found no repo.

## How does the orchestrator see progress and detect stuck or dead workers?

### Takeaway
All mature systems use layered detection: fast mechanical liveness checks first, then a costly AI judgment only on suspicion. The hard part is telling apart busy, idle, blocked, rate-limited and hung. Gas Town's self-reported heartbeats and TUI scraping both give false results, and its monitoring agents have silent failures of their own.

### Cited Findings
- **Gas Town patrol chain** [DOC]: Deacon (daemon beacon), Boot (ephemeral watchdog of the Deacon), Witness (per-rig polecat monitor, handles nudging and cleanup), Dogs (workers). Witnesses also watch the Deacon, and alert the Mayor when it looks unresponsive for over 5 minutes. — [architecture.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/architecture.md), [heartbeats.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/heartbeats.md)
- Gas Town has three heartbeat stores with different readers: Deacon file (5m stale, 20m very stale), per-session store with self-reported `working|idle|exiting|stuck` state, and a `heartbeat:<EPOCH>` label on the agent bead. [DOC] — [heartbeats.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/heartbeats.md)
- The doc warns to never declare an agent stuck from one store. Cross-check tmux `#{window_activity}`. It names "heartbeat-write divergence" as a live session with a stale store. [DOC] — [heartbeats.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/heartbeats.md)
- `GUPPViolationTimeout` is 30 minutes: work on hook without progress. [CODE] — [constants.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/constants/constants.go)
- Polecat states: Working, Idle, Done, Stalled, Zombie. [DOC] — [polecat-lifecycle.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/polecat-lifecycle.md)
- Gas Town detects busy by scraping "esc to interrupt" and idle by prompt prefix `❯ `. `WaitForIdle` needs 2 idle polls 200ms apart, because the prompt shows briefly in inter-tool gaps of about 500ms. [CODE] — [tmux.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/tmux/tmux.go)
- The maintainers say scraping "fails open and silently" on an upstream rename, and propose Stop/UserPromptSubmit hooks as the structural signal. [ISSUE, open, 2026-06-12] — [gastown #4245](https://github.com/gastownhall/gastown/issues/4245)
- Monitor failures reported: usage-limit block looks the same as a hang ([#4887](https://github.com/gastownhall/gastown/issues/4887), 2026-09-25); Refinery session alive but its await-event loop gone, so the queue sits "ready" forever ([#4386](https://github.com/gastownhall/gastown/issues/4386), 2026-07-04); healthy agents killed after a session-name mismatch ([#4787](https://github.com/gastownhall/gastown/issues/4787), 2026-08-31); patrol agent stalls after it slings work ([#4601](https://github.com/gastownhall/gastown/issues/4601), 2026-07-28). [ISSUE, titles and summaries]
- **Overstory** [CODE]: "Observable state is the source of truth, not recorded state." Signal order is tmux liveness, then PID, then recorded state. Agents with PID dead and tmux alive count as zombie. Defaults: stale 5 min, zombie 10 min. — [health.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/watchdog/health.ts), [config.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/config.ts)
- Overstory escalation in the Tier 0 daemon: nudge, then AI triage (Tier 1, if enabled), then kill the session. Its comments say Tier 2 is not implemented. [CODE] — [daemon.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/watchdog/daemon.ts)
- Overstory treats a watchdog-killed zombie as terminal for run completion, and then nudges the coordinator with a "(N completed, M zombie)" count, so the coordinator does not read it as a clean finish. [CODE] — [daemon.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/watchdog/daemon.ts)
- **Agent Orchestrator** [DOC]: The reaper probes runtime handles every 5 seconds. Load-bearing rule: "Never treat failed probes as death: A failed probe is a fact, not a termination signal." Activity comes from agent hooks as `active, idle, waiting_input, blocked, exited`. Claude TUI hook facts also track the parent turn and native subagent IDs, so a session stays active while a background subagent works. — [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md)
- Agent Orchestrator's SCM observer polls PRs on a 30s tick. [DOC] — [scm-observer.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/scm-observer.md)
- **Metaswarm** [DOC]: Never trusts self-reports. The orchestrator runs tests itself. External CLIs run with a `safe_invoke()` timeout (default 300s) because they "can hang". Auto-escalates to a human after 3 failed iterations. — [README](https://github.com/dsifry/metaswarm/blob/33d39f7/README.md), [external-tools skill](https://github.com/dsifry/metaswarm/blob/33d39f7/skills/external-tools/SKILL.md)
- Yegge's successor pattern: "crons watch, models act", about 45 scheduled units wake an agent when something needs judgment. [CLAIM, Aug 2026] — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)

### Inferences
- For Engy, the best signal order is: PTY process exit (kernel fact), then hook events, then output activity, then self-reports. Screen scraping should be a last fallback only.
- Usage-limit state needs its own detection, or watchdogs will kill or nudge healthy workers.
- Each monitor loop is also a worker that can die. Mechanical code should supervise agent monitors, as in the "crons watch, models act" pattern.

### Gaps
- I found no false-positive or false-negative rates for any watchdog.
- I did not confirm how Agent Orchestrator decides a live but silent worker is stuck. The code matches for "stuck" exist in `lifecycle/manager.go` and were not read.
- Symphony has `turn_timeout_ms`. I did not read its stall rules in detail.

## How is work delivered, and how is a busy worker handled?

### Takeaway
This is the most relevant area for Engy, and Gas Town is the main warning. PTY injection shares one input box with the human, and can interrupt, merge with, or lose text. The field is moving away from it to hook-drained queues at turn boundaries and to structured protocols (stream-json, ACP, app-server). The newest systems treat delivery as a tracked receipt, and do not treat a send as proof of delivery.

### Cited Findings
- **Gas Town nudge sequence** [CODE]: tmux literal mode, 500ms debounce, ESC (for vim mode), separate Enter, then SIGWINCH to wake detached sessions. Large text goes in chunks with 10ms delay. A per-session lock has a 30s timeout. Startup retries back off 500ms to 2s. — [tmux.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/tmux/tmux.go)
- A code comment states verification is "the Witness's job (AI), not this function". [CODE] — [tmux.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/tmux/tmux.go)
- **Three delivery modes** [CODE]: `wait-idle` (default) polls for idle, then falls back to queue, then to immediate. `queue` writes a file for the `UserPromptSubmit` hook to drain at the next turn boundary. `immediate` uses send-keys and interrupts work. — [nudge.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/cmd/nudge.go)
- The queue package comment says direct tmux text "cancels in-flight tool calls". Queue facts: one JSON file per nudge, FIFO by timestamp, normal TTL 30 min, urgent TTL 2 hours, max depth 50 per session, stale claim 5 min. [CODE] — [queue.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/nudge/queue.go)
- Agents without a hook need a poller. An agent idle at the prompt never fires `UserPromptSubmit`, so the queue would never drain. [CODE] — [nudge.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/cmd/nudge.go)
- Input collision has no fix: a nudge during human typing produces `Please fix the bug in auth[from crew/holden] Status update`. Open since 2026-02-06. [ISSUE] — [gastown #1216](https://github.com/gastownhall/gastown/issues/1216)
- Measured PTY failures [ISSUE, 2026-07-29, 30h window]: 9+ operator typing events with zero delivered; recovery Escape discards box text; immediate nudge merges with pending text and submits the fused string; wait-idle prints success with zero bytes delivered; unsubmitted text survives session recreation and returns in the next box. — [gastown #4610](https://github.com/gastownhall/gastown/issues/4610)
- A delivery that creates a new turn cancels the recipient's in-flight tool call. A delivery appended to an existing turn does not. Six occurrences reported, including a Postgres run killed mid-command. [ISSUE, 2026-07-29] — [gastown #4607](https://github.com/gastownhall/gastown/issues/4607)
- A full queue refused new nudges with no sign to the recipient. A P0 escalation about 251 destroyed records sat about 24 hours. Reply reminders filled the same 50 slots. [ISSUE, 2026-08-01] — [gastown #4634](https://github.com/gastownhall/gastown/issues/4634)
- tmux version drift: on 3.7b the flags sent were rejected, the error escaped the fallback chain, and Enter never submitted. [ISSUE, 2026-08-10] — [gastown #4666](https://github.com/gastownhall/gastown/issues/4666)
- A startup-nudge retry interrupted Claude mid-processing and left a polecat stuck. [ISSUE, 2026-03-19, title] — [gastown #3031](https://github.com/gastownhall/gastown/issues/3031)
- **Overstory** moved away from tmux. New projects spawn Claude headless, and task-scoped workers use spawn-per-turn. tmux is an opt-in attach path. [DOC/CODE] — [README](https://github.com/jayminwest/overstory/blob/ff38f3f/README.md), [CLAUDE.md](https://github.com/jayminwest/overstory/blob/ff38f3f/CLAUDE.md)
- Overstory mail reaches hooked agents by `ov mail check --inject` on SessionStart, UserPromptSubmit and PostToolUse (debounce 500ms). [CODE] — [hooks.json.tmpl](https://github.com/jayminwest/overstory/blob/ff38f3f/templates/hooks.json.tmpl)
- The headless cost: stream-json mode has no hooks, so PreToolUse guards (path boundary, capability, bash danger, tracker close) become advisory, and are marked "Drop". [DOC] — [headless-hooks-design.md](https://github.com/jayminwest/overstory/blob/ff38f3f/docs/headless-hooks-design.md)
- Overstory's sendKeys flattens newlines, because embedded Enter keys blocked final submission in Claude's TUI. [CODE] — [tmux.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/worktree/tmux.ts)
- **Agent Orchestrator** has two modes. TUI uses a native PTY/ConPTY runtime with tmux as legacy fallback. Chat uses native protocol controllers, with no terminal. [DOC] — [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md)
- In Chat mode, every message is queued in SQLite while a turn runs. Completion claims waiting messages in order and sends them as one input. An uncertain provider result closes receipts without replay of input the provider may have accepted. Terminal sessions keep their older delivery path. [DOC] — [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md)
- `ao send` queues during a busy turn. `--steer` atomically appends to the active turn or starts one if idle. A `--client-message-id` gives safe retries, and `--recover-only` reads the outcome without resending. [DOC] — [send.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/backend/internal/skillassets/using-ao/commands/send.md)
- Its tmux fallback sends `send-keys -l <chunk>`, then a separate `Enter`. [CODE] — [commands.go](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/backend/internal/adapters/runtime/tmux/commands.go)
- **Symphony**: Launches `codex app-server` and speaks its protocol over stdio. There is no terminal. [DOC] — [SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)
- **Metaswarm**: Claude `Task()` subagents, or Team Mode (`TeamCreate`, `SendMessage`) when available. Adversarial reviewers are always a fresh `Task()`. No PTY or tmux control. [DOC] — [agent-coordination.md](https://github.com/dsifry/metaswarm/blob/33d39f7/skills/orchestrated-execution/guides/agent-coordination.md)
- **Ruflo**: CLAUDE.md requires real work through Claude's Task tool. `hive-mind spawn --claude` launches one `claude` process with a prompt. [CODE/DOC] — [hive-mind.ts](https://github.com/ruvnet/ruflo/blob/bd77bce/v3/@claude-flow/cli/src/commands/hive-mind.ts), [CLAUDE.md](https://github.com/ruvnet/ruflo/blob/bd77bce/CLAUDE.md)
- Gas Town planned to move from tmux to Claude Agent Teams. The doc is marked "NOT YET IMPLEMENTED" and is dated 2026-02-08. — [witness-at-team-lead.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/witness-at-team-lead.md)
- Yegge says he uses neither sandboxing nor MCP. [CLAIM, Aug 2026] — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)

### Inferences
- Engy's MCP reply tool fixes the part tmux systems lack: an out-of-band ack. A PTY write is not delivery. Delivery should count only after a hook or MCP event from the worker.
- Keep the PTY prompt short. Put the payload in the store and inject only a pointer ("read dispatch 123"). Short text limits the damage of a merge or split.
- Rules that follow from #4610 and #4634: never send Escape in recovery, read the input box before writing, never report success on a fallback, make a queue overflow visible to the recipient, and keep priority traffic out of reminder slots.
- Use `UserPromptSubmit` and `Stop` hooks for the busy flag and queue drain, with a timer for the idle-at-prompt case. Worker-side hooks also stay available in a PTY, which headless Overstory lost.
- Use client message IDs and at-most-once replay, as in Agent Orchestrator.

### Gaps
- Agent Orchestrator's exact TUI delivery checks are not confirmed. `session_manager/manager.go` has logic near line 5287 about an idle-prompt session with an unsubmitted pasted draft, which I did not read in full.
- I did not test whether Claude Code preserves a tool call when text arrives during a turn. #4607 and the queue.go comment describe interruption for specific paths, and this may vary by Claude Code version.
- No project publishes a delivery success rate.

## How are results merged, and how are conflicts handled?

### Takeaway
Two models exist. Gas Town and Overstory run their own merge queue with gates. Agent Orchestrator, Symphony and Metaswarm use GitHub PRs and send failures back to the owning worker. Sending the conflict back to its author is the common cheap default. AI resolution is a later tier. At very high volume, Yegge dropped bisection for a batch smash-in.

### Cited Findings
- **Gas Town Refinery** [CODE]: A batch-then-bisect queue. Defaults are batch size 5, 30s wait, one retry of the full batch before bisecting (to clear flaky tests). `OnConflict` default is `assign_back`, the other option is `auto_rebase`. Results split into Merged, Culprits and Conflicts. — [batch.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/refinery/batch.go), [engineer.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/refinery/engineer.go)
- A comment says to use git porcelain output (`git diff --diff-filter=U`) to detect conflicts, not stderr parsing. [CODE] — [engineer.go](https://github.com/gastownhall/gastown/blob/466aa41/internal/refinery/engineer.go)
- Gas Town flow by mail: POLECAT_DONE, then Witness verifies clean git state and issue closed, then MERGE_READY, then Refinery merges, then MERGED makes the polecat safe to nuke. [DOC] — [mail-protocol.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/mail-protocol.md)
- **Yegge at scale** [CLAIM, Aug 2026]: About 175 real commits per day with a half-hour build gate. The queue grew past 100 MRs. His "Land Rush": "whenever the MQ hits 100, we abandon the bisection and just smash it all in with a megabatch", because agents "can diagnose red-main problems way faster than the bisection process". — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)
- **Overstory** [CODE]: SQLite FIFO queue plus 4 tiers: clean merge, auto-resolve (keep the agent's incoming side), AI resolve, and reimagine from scratch. Tier 3 output is checked to be code and not prose. A tier that failed 2 or more times on overlapping files and never succeeded is skipped. Tier 2 escalates when keeping incoming would silently lose data. — [resolver.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/merge/resolver.ts), [queue.ts](https://github.com/jayminwest/overstory/blob/ff38f3f/src/merge/queue.ts)
- Overstory's own critique: tier 4 "still requires human review for semantic conflicts", and conflicts are the normal case on shared files such as `types.ts` and `schema.sql`. [DOC] — [STEELMAN.md](https://github.com/jayminwest/overstory/blob/ff38f3f/STEELMAN.md)
- **Agent Orchestrator** [DOC]: One worktree and PR per session. The SCM observer detects PR comments, CI failures and conflicts, and routes each to the worker that owns the branch. Optional reviewer agent. — [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md), [README](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/README.md)
- **Metaswarm** [DOC]: Each unit runs IMPLEMENT, VALIDATE, ADVERSARIAL REVIEW, COMMIT. The writer is always reviewed by a different model when cross-model mode is on. A PR Shepherd agent lives in the worktree and monitors the PR to merge. — [README](https://github.com/dsifry/metaswarm/blob/33d39f7/README.md), [pr-shepherd](https://github.com/dsifry/metaswarm/blob/33d39f7/skills/pr-shepherd/SKILL.md)
- Yegge's pipeline: Fable design, Opus implementation, Fable review. [CLAIM, Aug 2026] — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)
- A zombie restart re-primed a polecat onto a closed bead, and merged work was redone. [ISSUE, 2026-08-14, title] — [gastown #4698](https://github.com/gastownhall/gastown/issues/4698)

### Inferences
- Engy should start with assign-back to the worker that owns the branch. It needs no new merge infrastructure. Keep the worker's context if its session is alive.
- A batch queue only pays off at a commit rate that a single-user workspace will not reach.
- Check bead/task closed state before re-priming a restarted worker.

### Gaps
- No project publishes conflict rates or the share of conflicts that AI resolves correctly.
- Overstory's `predict.ts` (conflict prediction) was not read.

## Does it work across repos? What roles and hierarchy are used?

### Takeaway
Gas Town has the most complete hierarchy and real cross-repo support (town, rigs, convoys). Most others have one project-level orchestrator plus workers. Depth is kept shallow. The role count of Gas Town is widely criticised as hard to learn.

### Cited Findings
- **Gas Town** [DOC]: Town level has Mayor (coordinator), Deacon, Boot, Dogs. Rig level has Witness, Refinery, Polecats (persistent identity, ephemeral sessions), Crew (human workspaces). — [architecture.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/architecture.md)
- Convoys are "the primary unit for tracking batched work across rigs". [DOC] — [convoy.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/convoy.md)
- Yegge says Gas Town was "intended to be reusable, but I only ever wound up using it to build itself". [CLAIM, Aug 2026] — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)
- Wheelhouse roles: "crew agents, fleet workers, and role agents with standing orders"; "the crew produces work, and the fleet consumes work". [CLAIM, Aug 2026] — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)
- **Gas City** rebuilds this as packs ("shareable sets of agents, formulas and orders"), a provider-neutral "factory worker" protocol, TOML formulas, and trigger-based orders. [CLAIM, 2026-04-28] — [Gas City 1.0](https://gascity-blog.pages.dev/posts/announcing-gas-city-1-0/)
- **Overstory** [DOC]: Persistent coordinator, leads, and task-scoped workers (scout, builder, reviewer). Scout and builder are leaves at depth 2. Persistent capabilities are coordinator, orchestrator, monitor. — [CLAUDE.md](https://github.com/jayminwest/overstory/blob/ff38f3f/CLAUDE.md)
- **Agent Orchestrator** [DOC]: A per-project main agent plans and starts workers in worktrees. It also has projectless standalone workers, and it supports 35+ agents [CLAIM]. — [README](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/README.md), [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md)
- **Metaswarm** [DOC]: Teams by level: `swarm-{initiative}`, `issue-{number}`, `review-{doc}`. 18 agents and 13 skills. — [agent-coordination.md](https://github.com/dsifry/metaswarm/blob/33d39f7/skills/orchestrated-execution/guides/agent-coordination.md)
- **Ruflo** advises 6-8 max agents and raft consensus for hive-mind. A May 2026 audit says hive-mind transport is an in-process EventEmitter. [DOC, 3P] — [CLAUDE.md](https://github.com/ruvnet/ruflo/blob/bd77bce/CLAUDE.md), [ruflo #1896](https://github.com/ruvnet/ruflo/issues/1896)
- Critic quoted: "The number of overlapping and ad hoc concepts in this design is overwhelming." Appleton expects simpler tools to adopt the useful ideas: supervised roles, disposable sessions with persistent state, and work queues. [3P, early 2026] — [Maggie Appleton](https://maggieappleton.com/gastown)

### Inferences
- Engy's workspace and project model maps well to town and rig. One orchestrator with one mechanical supervisor covers most needs before any Witness or Deacon style role.
- Split roles only when one role has a distinct tool scope. Overstory's capability guards are a clean way to enforce this.

### Gaps
- I found no clear statement of cross-repo support in Agent Orchestrator beyond multiple projects in one daemon. A grep of its docs for cross-project terms found nothing.
- Ruflo's plugin federation (ADR-104, ADR-109) was not evaluated.

## How do systems survive restarts and context loss?

### Takeaway
The shared answer: treat sessions as disposable and keep identity, sandbox and work state outside them. Agents recover by reading the store when they wake. Agent Orchestrator goes furthest, with detached per-session hosts that outlive the daemon. Restart still has traps: re-doing closed work, and stale input coming back.

### Cited Findings
- **GUPP**: "If you find something on your hook, YOU RUN IT." "There is no supervisor polling asking 'did you start yet?'" [DOC] — [propulsion-principle.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/propulsion-principle.md)
- Gas Town separates identity (long-lived), sandbox (per assignment) and session (one context window). The design doc lists the costs of conflating them: lost unpushed work, 219 stale remote branches, about 5s worktree creation per dispatch, lost history. [DOC, status "Design"] — [persistent-polecat-pool.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/persistent-polecat-pool.md)
- "Sessions are the pistons; sandboxes are the cylinders." State persists through branch, worktree and molecule. A PreCompact hook saves state. [DOC, updated 2026-03-07] — [polecat-lifecycle-patrol.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/polecat-lifecycle-patrol.md)
- Docs conflict: the patrol doc says `gt done` goes "idle (sandbox preserved)", while polecat-lifecycle.md says clean completion retires the session with no idle reuse. — [patrol doc](https://github.com/gastownhall/gastown/blob/466aa41/docs/design/polecat-lifecycle-patrol.md); contradicted by [polecat-lifecycle.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/concepts/polecat-lifecycle.md)
- `gt seance` lets an agent talk to a predecessor session: `gt seance --talk <id> -p "Where is X?"`. [DOC] — [reference.md](https://github.com/gastownhall/gastown/blob/466aa41/docs/reference.md)
- **Agent Orchestrator** [DOC]: Codex and ACP Chat processes run in detached per-session hosts, so replacing the daemon does not stop a turn. The ACP host preserves JSON-RPC correlation, pending interactions and acknowledged prompt replay. Hibernation stops a settled idle Chat host and resumes the native conversation on new work. — [architecture.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/architecture.md)
- **Overstory**: `ov prime` injects context on SessionStart and `ov prime --compact` on PreCompact. Re-priming after compaction in headless mode is deferred. [DOC] — [headless-hooks-design.md](https://github.com/jayminwest/overstory/blob/ff38f3f/docs/headless-hooks-design.md)
- **Metaswarm**: Plans and execution state persist to disk through Beads. `bd prime` loads a filtered subset of knowledge by files, keywords and work type. [DOC] — [README](https://github.com/dsifry/metaswarm/blob/33d39f7/README.md)
- **Symphony**: Exact scheduler state is not restored. Recovery comes from tracker and filesystem. [DOC] — [SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)
- Restart failures: closed work redone ([#4698](https://github.com/gastownhall/gastown/issues/4698)), stale input carried into a new session ([#4610](https://github.com/gastownhall/gastown/issues/4610)), recovery stuck forever on a garbage-collected wisp ([#4889](https://github.com/gastownhall/gastown/issues/4889), 2026-09-29). [ISSUE]

### Inferences
- Engy's split of server and daemon already lets sessions outlive a `cycle-web`. The daemon-side PTY is the equivalent of Agent Orchestrator's detached host. Pending dispatch receipts should be stored so that a server restart can reconcile them.
- A wake-up prompt should tell a worker to read its assignment from the store, and to check it is still open before it starts.

### Gaps
- I found no measured recovery rates after compaction for any system.

## What failures, costs and real-world results are reported?

### Takeaway
Most numbers are self-reported by authors. The strongest cost datum is Overstory's own example: a swarm cost about 6.7x the tokens for a 25% time saving. Gas Town's author says it failed with a model change, and that a new model tic broke convergence. Ruflo's main swarm runtime was reported as not executing end-to-end in May 2026, and the maintainer's spot-check agreed.

### Cited Findings
- **Gas Town end** [CLAIM, Aug 2026]: "Gas Town fell apart at the seams with Opus 4.7." It worked "brilliantly" through 4.6. A "just two more things" tic "prevented Opus from ever converging on being ready to do real work", and "it always wanted to fiddle with Gas Town itself". "It had other problems, too". Fetched through a summarizer; Simon Willison quotes the same lines. — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/), [Willison](https://simonwillison.net/2026/Aug/4/)
- **Yegge's costs** [CLAIM, Aug 2026]: About $87k/month API-equivalent, about 69 billion tokens in July, 96% cache hits, about $2,800/month actual spend on 13 Max accounts plus $17/month each in Workspace fees. He says this is "almost certainly a violation" for multi-person companies. This is for Wheelhouse, not Gas Town. — [Yegge](https://yegge.ai/essays/the-shape-of-things-to-come/)
- Earlier figures: "thousands of dollars a month in API costs", and the build took "17 days, 75k lines of code, 2000 commits". [3P] — [Appleton](https://maggieappleton.com/gastown). A figure of $2,000-$5,000/month appears only in a [Korean summary](https://news.hada.io/topic?id=26091), unverified.
- Gas Town is "100% vibe coded. I've never seen the code", as quoted in a [search summary](https://hn.jakechampion.name/item/47250133). I did not locate the primary line. Treat this as unconfirmed.
- Gas Town has 503 open issues and PRs combined per the GitHub API. A search on stuck, nudge and zombie terms returned 40 or more results, most of them open. This repo's issue list is a good failure catalogue, but issue count is weak evidence, since agents file many issues.
- **Overstory cost example** [DOC, author's own, no raw data]: 20 agents, 15 tasks, 6 hours, 8M tokens, about $60; one agent, 8 hours, 1.2M tokens, about $9. "The 2-hour speedup cost $51 in additional coordination overhead." — [STEELMAN.md](https://github.com/jayminwest/overstory/blob/ff38f3f/STEELMAN.md)
- Overstory also lists compounding errors at integration boundaries, inconsistent naming, duplicated utilities, forensic debugging, and premature decomposition. [DOC] — [STEELMAN.md](https://github.com/jayminwest/overstory/blob/ff38f3f/STEELMAN.md)
- Overstory's project was archived in favour of Warren, "a self-hostable control plane for sandboxed cloud agents". [DOC] — [README](https://github.com/jayminwest/overstory/blob/ff38f3f/README.md)
- **Ruflo audit** [3P via maintainer issue, May 2026, v3.6.30]: "the multi-agent swarm runtime its README describes does not yet execute end-to-end". `agent_spawn` writes a record with no subprocess, and the maintainer's spot-check said "Claim still holds". About 195 of 240 MCP tools verified real. — [ruflo #1896](https://github.com/ruvnet/ruflo/issues/1896)
- Current ruflo code as of `bd77bce`: `hive-mind_spawn` still creates agent records in state ([hive-mind-tools.ts](https://github.com/ruvnet/ruflo/blob/bd77bce/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts)). Later code adds a real path: `agent_execute` dispatches a prompt to an Anthropic model through a provider ([agent-execute-core.ts](https://github.com/ruvnet/ruflo/blob/bd77bce/v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts)). This is an API call. It does not control a coding agent. [CODE]
- A March 2026 independent review reports fabricated `security scan` counts, hardcoded deployment stubs, a hardcoded 3.92x quantization figure, and an obfuscated preinstall script removed in v3.5.3. [ISSUE, 3P, not reproduced] — [ruflo #1482](https://github.com/ruvnet/ruflo/issues/1482)
- Metaswarm publishes no measured results that I found. Its numbers are feature counts. — [README](https://github.com/dsifry/metaswarm/blob/33d39f7/README.md)
- Agent Orchestrator: no published throughput or cost results found. It reports a repo-rename bug cluster caused by five independent PR identity derivations. [DOC] — [scm-observer.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/b7091d8/docs/scm-observer.md)
- Appleton's view: when agents write most of the code, design and planning become the limit. [3P] — [Appleton](https://maggieappleton.com/gastown)

### Inferences
- Ask for proof of worker execution when reading any orchestrator's claims. "Spawned" in an MCP tool can mean only a row in a store.
- Model behaviour is a dependency. A prompt-driven system can break on a model update with no code change, so Engy needs regression checks on orchestrator prompts.
- Limit orchestrator tasks that touch its own tooling, given the "fiddle with Gas Town itself" failure.
- Budget and token metering per worker should exist from the start. Coordination traffic (nudges, reminders, patrol turns) is the waste to measure.

### Gaps
- No independent, controlled comparison of swarm and single-agent output was found.
- The Overstory token example has no public data set.
- Primary Yegge posts on Medium could not be fetched (HTTP 403). The original "Welcome to Gas Town" numbers are only from secondary sources here.
- Klabnik's essay was not fetched (my guessed URL returned 404). It is referenced only through a search summary, so I did not use it.
