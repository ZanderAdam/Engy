# Vendor-built multi-agent coding orchestration (as of 2026-10-31)

**Evidence tags.** All research was done on 2026-10-31. `[DOC]` = official doc page fetched that day (the doc says this; the pages carry no date of their own unless noted). `[DOC-S]` = official page seen only as a search excerpt, not fetched in full. `[ISSUE]` = user bug report; the vendor has not confirmed it unless noted. `[3P]` = third-party source. Status of each feature is in brackets where the source gives one. Items under Inferences are mine, not from a source.

**Status summary**

| Product | Feature | Status at 2026-10-31 |
|---|---|---|
| Claude Code | Subagents | Shipped; on by default |
| Claude Code | Agent teams | Experimental; off by default; interactive sessions only |
| Claude Code | Cross-session messaging | On by default from v2.1.224 |
| Claude Code | Agent view / background sessions | Research preview |
| OpenAI Codex | Subagents | On by default; config reference says "stable" |
| OpenAI Codex | Cloud, app worktrees | Shipped |
| Cursor | Agents Window | GA with Cursor 3 (released 2026-04-02) |
| Cursor | Subagents, cloud subagents | Shipped; no status label found |
| GitHub | Copilot in the cloud (new experience) | Paid plans from 2026-10-28 |
| GitHub | /fleet | CLI feature; SDK binding experimental |
| Google | Antigravity CLI / app | Replaces Gemini CLI; only partly verified |

Note on naming: Codex docs now live at learn.chatgpt.com (old developers.openai.com/codex paths return 308 redirects). The current GitHub docs I fetched use "Copilot in the cloud" and do not use "Agent HQ"; I could not confirm whether the Agent HQ brand is still in use.

## How does the lead or orchestrator see what workers are doing?

### Takeaway
Local tools push worker completion to the lead as a structured event or notification, so the lead does not poll. Cloud products expose runs through status APIs, streams, and PR state. No product documents that the lead reads a worker's terminal screen as its main signal.

### Cited Findings

**Claude Code agent teams** (experimental; last confirmed 2026-10-31)
- Message delivery is automatic and the lead does not poll. When a teammate stops, it notifies the lead and includes its final answer. If a turn ends on an API error, the notification says it failed and includes the error text. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Shared task list has three states (pending, in progress, completed) plus dependencies shown as blocked. Claims use file locking. Dependents unblock automatically. Stored at `~/.claude/tasks/{team-name}/`. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Team config at `~/.claude/teams/{team-name}/config.json` holds a `members` array; teammates can read it for discovery. Do not edit it by hand. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Hooks: `TeammateIdle` (exit 2 keeps the teammate working), `TaskCreated` and `TaskCompleted` (exit 2 blocks the action and sends feedback). `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Human view: agent panel below the prompt, or split panes with tmux/iTerm2. Idle rows hide 30 seconds after the whole panel is idle, but the teammate stays addressable. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)

**Claude Code subagents and sessions** (last confirmed 2026-10-31)
- Foreground subagent result is the Agent tool's output. Background result arrives as a completion notification. Only the final summary enters the parent context. `[DOC]` — [Subagents](https://code.claude.com/docs/en/sub-agents)
- Hooks `SubagentStart` and `SubagentStop` match on agent name. Settings-level `PreToolUse`/`PostToolUse` also fire for subagent tool calls. Transcripts are at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`. `[DOC]` — [Subagents](https://code.claude.com/docs/en/sub-agents)
- Before Claude reads a subagent report, Claude Code scans it for text that imitates system output and neutralizes that text with a backslash. `[DOC]` — [Subagents](https://code.claude.com/docs/en/sub-agents)
- Agent view (research preview) shows six session states: Working, Needs input, Idle, Completed, Failed, Stopped; a one-line Haiku-class summary per row; PR status labels. `claude agents --json` gives machine-readable state; the docs say not to parse `~/.claude/jobs/`. `[DOC]` — [Agent view](https://code.claude.com/docs/en/agent-view)
- `SendMessage` with `notify_when_idle` subscribes to one notice when a local session goes idle or exits. Subscribing alone does not start a turn or spend tokens in the watched session. Dropped after 12 hours. Requires v2.1.236 in both sessions; main conversation only, same machine only. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)

**OpenAI Codex** (last confirmed 2026-10-31)
- The main thread collects subagent results into one consolidated response and waits until all requested results are available. Subagents return summaries, not raw output. `/subagents` in the CLI lists and switches agent threads. `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- Surfaces: desktop app, CLI, and IDE extension show activity. The web sidebar reports activity but has no controls to stop or steer. `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- `SubagentStart` hook exists, matched on subagent type, and can add developer context; `continue: false` does not stop the subagent. `[DOC-S]` — [Hooks](https://learn.chatgpt.com/docs/hooks)
- `SubagentStart`/`SubagentStop` expose only the child `agent_id`, with no link to the parent's spawn call (validated by the reporter against rust-v0.153.4). `[ISSUE]` — [openai/codex#44095](https://github.com/openai/codex/issues/44095)
- App-server item type reported as `collabAgentToolCall` with values such as spawnAgent, sendInput, wait, closeAgent. `[3P]`, not checked against the official app-server page — [harnss#40](https://github.com/OpenSource03/harnss/issues/40)

**Cursor** (last confirmed 2026-10-31)
- Background subagents write output to `~/.cursor/subagents/`; the parent can read these files to check progress. `[DOC]` — [Subagents](https://cursor.com/docs/agent/subagents)
- Cloud Agents API: `POST /v1/agents/{id}/runs` for follow-ups. v1 was reworked around durable agents and per-prompt runs, with status, streaming, and cancellation per run, and SSE run streaming with reconnect. `[DOC-S]` — [API endpoints](https://cursor.com/docs/cloud-agent/api/endpoints)
- Cloud agents can subscribe to PR activity, CI results, Slack, Linear, and timers. Events wake the agent in the same conversation as follow-up messages. Bursts can wake it once, and it re-reads the source before acting. Max 180 days. Run events include `pr_created` and `pr_creation_failed`. `[DOC]` — [Capabilities](https://cursor.com/docs/cloud-agent/capabilities)

**GitHub Copilot** (last confirmed 2026-10-31)
- SDK session event stream emits `subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`, `subagent.deselected`. Lifecycle hooks: `subagentStart` (can prepend context to the child's first prompt), `subagentStop` (can request another child turn or replace the response to the parent). `[DOC]` — [Fleet mode](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/fleet-mode). Conflict: one GitHub docs version seen in search says a dedicated SDK hook callback for these was not found in the public SDK surface on that branch.
- Fleet coordination uses explicit SQL state: `todos` (statuses pending, in_progress, done, blocked) and `todo_deps`. The orchestrator queries for pending todos whose dependencies are all done. `[DOC]` — [Fleet mode](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/fleet-mode)
- `/tasks` in the CLI lists subagent subtasks with details and a summary after completion. `[DOC]` — [/fleet](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/speed-up-task-completion)
- Hook inputs identify the parent session but lack a shared tool-call ID to correlate with `subagent.*` events. `[DOC]` — [Fleet mode](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/fleet-mode)
- Mission control is the human view to assign, steer, and track agent tasks (announced 2025-10-28). `[DOC-S]` — [Changelog](https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/). A repository Agents tab followed on 2026-01-26. `[DOC-S]` — [Changelog](https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository/)

**Google Antigravity** (partly verified)
- The CLI `/agents` panel monitors background subagents, can inspect or terminate them, and Alt+J jumps to the next subagent that waits for confirmation. `[DOC-S]` — [/agents](https://antigravity.google/docs/cli/commands/agents/)

### Inferences
- A PTY-based orchestrator lacks the two signals most vendors depend on: a structured turn-end event and a typed final result. Claude Code's `TeammateIdle`/`Stop`-class hooks and Codex/Copilot `SubagentStop`-class hooks are the closest match to what a PTY orchestrator can attach to, which is more reliable than screen scraping.
- Two vendors lack spawn-to-child correlation in hook payloads (Codex #44095, Copilot docs). An orchestrator should own its worker IDs and pass them in at spawn, for example through env vars.
- Three separate designs converge on one shape: task state lives in durable storage outside any agent context (files with locks, SQL tables, API runs).

### Gaps
- Cursor local status events for subagents: the fetched page does not cover the `subagentStart`/`subagentStop` hooks, and I did not fetch the hooks page.
- The official Codex app-server page was not retrieved.
- Current state of Agent HQ third-party agent status views.

## How does it send work and get results back?

### Takeaway
There are four patterns: tool call with final summary (all subagents), file or socket mailbox (Claude Code), mid-turn steering queue (Copilot, Cursor API, Claude cross-session), and PR as the result (all cloud agents). Delivery timing is the weak point and has real bug reports.

### Cited Findings

**Claude Code**
- Each agent's mailbox is a JSON file at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`. Entries are validated on read; invalid ones are reported and removed. A message counts as sent only when the file write succeeds. There is no broadcast: send one message per recipient. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Spawn: Agent tool with a `name` while teams are enabled launches a teammate, unless the call is a fork or passes `isolation` on the call. Claude can name subagents itself, so teams can form when not requested. Teammates receive the spawn prompt, not lead history. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Messaging an in-process teammate that is no longer running brings it back and gives the message as its next prompt. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- `SendMessage` to a completed subagent resumes it in the background. A subagent the user stopped does not auto-resume and messages to it are refused. `[DOC]` — [Subagents](https://code.claude.com/docs/en/sub-agents)
- Cross-session messaging: the receiver reads a message between tool calls during an active turn, so a running tool is never interrupted; an idle session starts a new turn. Same-machine transport is a per-session Unix socket (named pipe on Windows), never through Anthropic servers. Plain text only. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- Scripts and hooks can post to a session socket through `CLAUDE_CODE_MESSAGING_SOCKET`, with `CLAUDE_CODE_MESSAGING_TOKEN` for auth (optional on macOS/Linux, required on native Windows). A connection with no complete line in 30 seconds is closed. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- `claude -p` workers bind an inbox too; bare mode does not. Set `crossSessionInbound: accept` in `--settings` for unattended workers. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)

**OpenAI Codex**
- Tool names conflict by source. Config reference: `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent` (`[DOC-S]` — [Config reference](https://developers.openai.com/codex/config-reference)). Issue reports on recent builds: `spawn_agent`, `followup_task`, `send_message`, `interrupt_agent`, `list_agents`, `wait_agent` (`[ISSUE]` — [#22779](https://github.com/openai/codex/issues/22779)). Source has a separate `multi_agents_v2.rs` handler — [source](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_v2.rs). The likely reason is a V1/V2 tool surface change, but that is my inference.
- Docs say Codex handles spawning, routing follow-ups, waiting, and closing; users steer by asking Codex. `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- Cloud: tasks start from a published environment; review changes and test results, request follow-ups, then commit or open a PR. Started from web, mobile, desktop, CLI, or ChatGPT in Slack. `[DOC]` — [Codex Cloud](https://learn.chatgpt.com/docs/cloud)

**Cursor**
- Parent uses the Task tool; several calls in one message run concurrently. Each run returns an agent ID, which can resume it with context kept. Failure returns an error status so the parent can retry or resume. `[DOC]` — [Subagents](https://cursor.com/docs/agent/subagents)
- Without a delivery option, a prompt to `POST /v1/agents/{id}/runs` starts a new run that keeps conversation and workspace state; the endpoint also supports a steer to an active agent. `[DOC-S]` — [API endpoints](https://cursor.com/docs/cloud-agent/api/endpoints)
- `/in-cloud` sends the next task to a cloud subagent. `/autopilot` asks one to iterate on a PR until ready to merge. `[DOC]` — [Subagents](https://cursor.com/docs/agent/subagents)

**GitHub Copilot**
- `/fleet` subagents get their own context but share one filesystem, and cannot talk to each other; only the orchestrator coordinates. `[DOC-S]` — [GitHub blog](https://github.blog/ai-and-ml/github-copilot/run-multiple-agents-at-once-with-fleet-in-copilot-cli/)
- SDK: `session.rpc.fleet.start({ prompt })`, wire method `session.fleet.start`, returns a `started` flag. `[DOC]` — [Fleet mode](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/fleet-mode)
- SDK send modes: `immediate` injects into the current LLM turn; `enqueue` runs after the turn ends. If the agent has already committed to a tool call, steering applies after that call, within the same turn. `[DOC-S]` — [Steering and queueing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/steering-and-queueing)
- Cloud agent output is one branch and one PR per task. `[DOC]` — [About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)

### Inferences
- The Claude socket interface is the closest vendor analog to PTY prompt injection, and it adds what raw injection lacks: size caps, per-sender throttling, sender identity, and a stated delivery point (between tool calls).
- PTY injection has a timing risk that these APIs handle: text typed while a turn runs may be queued, treated as steering, or lost, based on the CLI. Copilot's split between `immediate` and `enqueue` and Claude's "Waiting to be delivered" state suggest an orchestrator should have an explicit delivery state and an ack, which an MCP reply tool can give.
- The MCP reply tool matches the vendor pattern of a typed final message. The vendors treat this as a mandatory end-of-work step, and their failure reports concern cases where it did not happen, so a fallback for "worker went idle with no reply" is needed.

### Gaps
- Whether the Codex collab tool names in the config reference are current; the docs and issue reports disagree.
- Exact semantics of the Cursor steer delivery option: only seen in a search excerpt.

## What is the isolation model?

### Takeaway
Local workers default to a shared checkout unless told otherwise (Cursor, Copilot fleet, Claude teams). Worktrees are the opt-in or per-session local boundary. Cloud is a per-task VM or sandbox, with Cursor documenting Firecracker microVMs.

### Cited Findings
- **Claude teammates**: no worktree isolation is documented. Two teammates editing the same file overwrite each other; docs say to give each a different file set. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- **Claude subagents**: `isolation: worktree` gives a temporary worktree branched from the default branch, not the parent `HEAD`. It is removed if unchanged. Commands that resolve to the main checkout fail. `[DOC]` — [Subagents](https://code.claude.com/docs/en/sub-agents)
- **Claude background sessions**: a dispatched session moves into a worktree under `.claude/worktrees/` before it edits. This is skipped for sessions moved from a terminal, non-git directories, or writes outside the working directory. Agents are told never to push to main, force-push, or merge. `[DOC]` — [Agent view](https://code.claude.com/docs/en/agent-view)
- **Codex app**: Local is foreground; Worktree is background. Worktrees live in `$CODEX_HOME/worktrees`, start in detached HEAD, and take uncommitted changes from the selected branch. Handoff moves a chat and its code between the two. `.worktreeinclude` copies ignored files. Codex keeps the 15 most recent managed worktrees and snapshots before deletion. `[DOC]` — [Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- **Codex subagents**: inherit parent sandbox and approval settings; custom agent files cannot override. `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- **Codex cloud**: each task has its own workspace; multiple tasks share setup but keep working state separate. Network is configured per environment. Docs do not say "container". `[DOC]` — [Codex Cloud](https://learn.chatgpt.com/docs/cloud)
- **Cursor subagents**: by default share the parent checkout, so concurrent edits can overwrite each other. Isolation is on request: worktree on the same machine, or a cloud VM with a repo clone. Changes stay on the subagent's branch until the parent merges. `[DOC]` — [Subagents](https://cursor.com/docs/agent/subagents)
- **Cursor cloud**: each agent has its own VM boundary, on Firecracker-based microVMs, in a separate AWS account. Snapshots deleted after 90 days of inactivity. `[DOC-S]` — [Security](https://prod.cursor.com/docs/cloud-agent/security). Each VM has a full desktop. `[DOC]` — [Capabilities](https://cursor.com/docs/cloud-agent/capabilities). Self-hosted workers exist. `[DOC-S]` — [Runtime choice](https://cursor.com/docs/cloud-agent/self-hosted/choose-runtime)
- **Copilot cloud**: three environments: cloud sandbox, GitHub Actions, and Remote (custom environment). Sandboxes honor firewall allowlists but do not support custom compute or self-hosted runners; Actions does. `[DOC]` — [About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- **Copilot /fleet**: subagents share the filesystem; docs advise against tightly coupled edits. `[DOC-S]` — [Fleet mode](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/features/fleet-mode)
- **Antigravity**: subagents can work across isolated Git worktrees. No further detail found. `[DOC-S]` — [Overview](https://antigravity.google/docs/overview/)

### Inferences
- Per-worker worktrees match the local vendor norm, and a shared checkout is the documented failure case in three products.
- Note the Claude base-branch trap: a subagent worktree branches from the default branch, so it does not see the parent's uncommitted or local-branch work.

### Gaps
- No vendor doc states resource limits per cloud VM in numbers. Cursor says only "limited memory and CPU".
- Whether Claude teammates can get worktree isolation through a subagent definition is unclear: docs list which frontmatter fields apply to teammates, and `isolation` is not in the list.

## Can one orchestrator work across several projects or repos?

### Takeaway
Human dashboards span projects in all major products. An agent-level orchestrator that spans repos is rare: Claude cross-session messaging is the nearest local option, and cloud multi-repo exists in Codex, Cursor, and Copilot sandboxes. Claude agent teams are explicitly limited to one session.

### Cited Findings
- **Claude teams**: one team per session, no sharing across sessions, no nested teams, lead fixed for life. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- **Claude agent view**: lists background sessions from all projects by default; `claude agents --cwd <path>` narrows; `@<repo>` targets a directory at dispatch. Teammates and subagents are not separate rows. `[DOC]` — [Agent view](https://code.claude.com/docs/en/agent-view)
- **Claude cross-session**: `ListAgents` finds local sessions regardless of directory, plus cloud and other-machine sessions while connected to Remote Control. Container and host sessions cannot reach each other; nor can WSL 2 and native Windows. Cloud sessions cannot reply with `SendMessage` to a message from another machine. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- **Claude cloud**: agent view points to "Projects" for cloud-hosted parallel sessions; not researched further. `[DOC]` — [Agent view](https://code.claude.com/docs/en/agent-view)
- **Codex cloud**: an environment takes several GitHub repositories; the example shows 4. `[DOC]` — [Codex Cloud](https://learn.chatgpt.com/docs/cloud)
- **Cursor**: Agents Window has a Multi-workspace feature across projects. `[DOC]` — [Agents Window](https://cursor.com/docs/agent/agents-window). Cloud multi-repo needs an environment with two or more repos, and a single-repo environment cannot be edited to add repos. `[DOC-S]` — [Cloud Agents](https://cursor.com/docs/cloud-agent). A January 2026 forum thread said multi-repo was unavailable, likely outdated — [forum](https://forum.cursor.com/t/multi-repo-support-on-cloud-agents/152970)
- **Copilot**: Actions sessions are limited to one repo. Cloud sandbox sessions span several repos in one organization. Both are limited to one branch at a time and one PR per task. `[DOC]` — [About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- **Antigravity**: a third-party write-up says 2.0 is built around orchestrating agents across projects. `[3P]` — [Substack](https://aipositive.substack.com/p/from-gemini-cli-to-antigravity-why)

### Inferences
- A cross-project orchestrator is a real gap in vendor offerings: most multi-repo support is one agent editing several repos, or a dashboard for a human. Few products document a lead agent that coordinates workers across unrelated local repos. Claude cross-session messaging can do this, but it is peer messaging, with no task list and no lifecycle control.
- Copilot's "one branch per task" with multi-repo sandboxes leaves it unclear how results map to PRs. I found no documentation on this.

### Gaps
- Copilot PR behavior for a multi-repo sandbox session.
- Whether Codex subagents can work across repos in a single local session.

## How does the human stay in control?

### Takeaway
All products let the human enter a worker and redirect it. Local tools route permission prompts up to one place, and messages from other agents never count as approval. Cloud products use PR review as the main gate and limit what the agent can do on the repo.

### Cited Findings

**Claude Code**
- Teammate permission prompts appear in the lead session, and teammates start with the lead's mode (`dontAsk` excepted). `--dangerously-skip-permissions` on the lead applies to all. Per-teammate modes can change only after spawn. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Plan approval is mostly automatic: a teammate spawned in plan mode has its plan approved on arrival, without lead review. If you put a running in-process teammate into plan mode with Shift+Tab, the lead reviews it. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Direct control: select a teammate and Enter to view and message; Escape interrupts its turn; `x` stops it; Ctrl+T toggles the task list. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- An agent message cannot approve a prompt or stand in for user consent. A denied teammate cannot relay the action to another to bypass the check. In auto mode, a classifier reviews each agent-to-agent message before delivery and can block it. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- Cross-session default: a bypass-mode receiver holds messages from non-bypass senders for approval. `crossSessionInbound` is accept, hold, or refuse. `isolatePeerMachines: true` forces approval for off-machine messages even in bypass mode. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- Agent view: peek replies do not answer a permission dialog; you must attach. A session that waits on a prompt shows as Needs input and does not proceed. `[DOC]` — [Agent view](https://code.claude.com/docs/en/agent-view)

**OpenAI Codex**
- CLI approval requests can come from inactive threads; the overlay names the source and `o` opens that thread. In non-interactive flows, an action that needs new approval fails and the error returns to the parent. `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- `agents.interrupt_message` defaults to true; its behavior is not explained on the fetched page. `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

**Cursor**
- A human can take control of the cloud agent's remote desktop and hand it back at any time. `[DOC]` — [Capabilities](https://cursor.com/docs/cloud-agent/capabilities)
- A cloud agent can move to local to iterate and back to the cloud. `[DOC]` — [Agents Window](https://cursor.com/docs/agent/agents-window)
- `readonly: true` subagents cannot edit files or run state-changing shell commands. Subagents inherit all parent tools. `[DOC]` — [Subagents](https://cursor.com/docs/agent/subagents)

**GitHub Copilot**
- A plain prompt during work is steering; Ctrl+Enter or Ctrl+Q queues it. A user can give inline feedback when rejecting a tool permission. `[DOC]` — [Steer agents](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/use-copilot-cli/steer-agents)
- Cloud sessions can start on one surface and continue on another. CLI sessions can be monitored remotely, but the local machine must stay online. `[DOC]` — [About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- Cloud agent PRs are drafts; it cannot mark them ready, and cannot approve or merge. `[DOC-S]` — [About cloud agent](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- Agent HQ agents can commit only to designated branches. `[DOC-S]`, 2025 source — [Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/)
- Third-party agents have the same protections and limits as Copilot, but each agent type is enabled separately. `[DOC-S]` — [Third-party agents](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/about-third-party-coding-agents)

**Antigravity**
- `artifactReviewPolicy` defaults to waiting for review; `agent-decides` currently behaves the same; `always-proceed` never pauses. It does not affect file edits. `[DOC-S]` — [Artifact review](https://antigravity.google/docs/artifact-review/)

### Inferences
- A PTY orchestrator has a free take-over path: the human can type in the same terminal. In vendor tools this is a built feature with caveats, such as Claude's peek replies not answering permission prompts.
- Automatic plan approval in Claude teams shows that an agent lead is not treated as a human gate. An orchestrator should keep "approved by a human" as a separate, unforgeable state.
- Worker text injected through a PTY arrives looking like user input. Vendors instead mark agent messages as non-user and non-consent. This is the largest trust gap of the PTY design, and it deserves a marked envelope format at the least; the worker still cannot verify it at the same level as a harness-level flag.

### Gaps
- No Copilot approval workflow for cloud agent actions is described on the fetched page.
- Cursor local approval routing for parallel subagents was not found.

## What limits and known failures are documented?

### Takeaway
Limits are mostly concurrency, depth, and session duration. The most common failures across vendors are lost or late completion signals and leaked concurrency slots. Both are coordination-state bugs, not model bugs.

### Cited Findings

**Documented limits**
- **Claude subagents**: 20 concurrent by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), three layers depth by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), no per-session total. `[DOC]` — [Subagents](https://code.claude.com/docs/en/sub-agents)
- **Claude teams**: no hard teammate limit; recommends 3-5 teammates and 5-6 tasks each. Not available in `-p` or Agent SDK sessions. No background subagents from in-process teammates. Split panes not supported in VS Code terminal, Windows Terminal, or Ghostty. `/resume` and `/rewind` do not restore in-process teammates. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- **Claude teams known behavior**: task status can lag and block dependents; shutdown can be slow; teammates may stop on errors; lead may stop early or start implementing itself; orphaned tmux sessions. In-process teammate cache TTL is 5 minutes by default. `[DOC]` — [Agent teams](https://code.claude.com/docs/en/agent-teams)
- **Claude cross-session**: about 1 million characters per message; burst refusal at sender; 50 queued accepted messages; 100 held messages, then oldest dropped; identical repeats dropped; per-sender rate limit, so loops stop on their own. `[DOC]` — [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- **Claude background sessions**: idle unattached processes stop after about an hour, then resume on attach or reply. Supervisor crashes restart; a machine shutdown stops running sessions. `[DOC]` — [Agent view](https://code.claude.com/docs/en/agent-view). The page's Limitations section was past what I read.
- **Codex**: `agents.max_concurrent_threads_per_session` (legacy alias `agents.max_threads`). `[DOC]` — [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents). A default of 6 comes from a third-party guide only. Docs recommend parallel agents mainly for read-heavy tasks. Codex does not spawn subagents unless asked (older doc excerpt, may be stale). `[DOC-S]` — [concepts/subagents](https://developers.openai.com/codex/concepts/subagents.md)
- **Cursor**: one nesting level below direct subagents. Roughly linear token cost, and subagents are not necessarily faster. `[DOC]` — [Subagents](https://cursor.com/docs/agent/subagents). CI auto-fix limited to 10 follow-ups per PR, GitHub Actions only, Teams and Enterprise only. `[DOC]` — [Capabilities](https://cursor.com/docs/cloud-agent/capabilities). Stop-hook auto follow-ups default to 5 per conversation. `[DOC-S]` — [Hooks](https://cursor.com/docs/hooks)
- **Copilot**: Actions sessions stop at 59 minutes, no extension. GitHub-hosted repos only. Retention 28 days for Actions, account life for sandboxes. `[DOC]` — [About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent). `--fleet` is not supported with `--acp`. `[DOC]` — [/fleet](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/speed-up-task-completion). Fleet is experimental in generated bindings; the SQL todos contract may not be stable; parallel workers can make inconsistent assumptions. `[DOC]` — [Fleet mode](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/fleet-mode)
- **Gemini CLI**: stopped serving Google AI Pro, Ultra, and free users on 2026-06-18, replaced by Antigravity CLI. Subagents carry over; `.gemini/agents/*.md` files do not load unchanged (`[3P]` for the last point). `[DOC-S]` — [Discussion #27274](https://github.com/google-gemini/gemini-cli/discussions/27274)

**Reported failures: Claude Code agent teams** (all `[ISSUE]`; fix state not checked unless noted)
- [#98998](https://github.com/anthropics/claude-code/issues/98998) (v2.1.287, tmux, macOS, opened 2026-10-02, open, no maintainer reply): a lead message to a running teammate returned success, the inbox file emptied quickly, but the message arrived only after the turn ended. The lead cannot steer during a long turn. The reporter says this conflicts with the cross-session doc text on delivery between tool calls.
- [#76500](https://github.com/anthropics/claude-code/issues/76500) (v2.1.206): 5 to 62 minute delays at turn boundaries; final reports lost, with an idle notification arriving instead; shutdown handshake does not complete.
- [#50779](https://github.com/anthropics/claude-code/issues/50779): inbox messages to the lead deferred until `end_turn`.
- [#23415](https://github.com/anthropics/claude-code/issues/23415), [#24108](https://github.com/anthropics/claude-code/issues/24108), [#24771](https://github.com/anthropics/claude-code/issues/24771): tmux teammates do not read the mailbox and sit at the idle prompt.
- [#58762](https://github.com/anthropics/claude-code/issues/58762): named agent registered with tmux routing but runs as a native process; instructions never arrive.
- [#34668](https://github.com/anthropics/claude-code/issues/34668): default-mode teammates stop receiving messages after extended polling.
- [#105258](https://github.com/anthropics/claude-code/issues/105258) (about 2026-10-26): a named agent spawned from a sub-agent returns its result to no one, because the lead's inbox poller does not start.

**Reported failures: Codex** (all `[ISSUE]`)
- [#22779](https://github.com/openai/codex/issues/22779) (opened 2026-05-15, open, bug label, no technical maintainer reply, latest comment 2026-09-12): completed subagents count against the thread limit, so `spawn_agent` fails with "agent thread limit reached". Closing frees the slot, but one comment says `close_agent` was missing from the model-visible tools. Reported through 0.153.4.
- [#39694](https://github.com/openai/codex/issues/39694): false limit with 1 Active / 12 Done. [#34518](https://github.com/openai/codex/issues/34518): completed subagents remain as hidden blockers. [#32353](https://github.com/openai/codex/issues/32353): a queued message to a completed agent pins a slot, and the parent cannot tell why. [#18335](https://github.com/openai/codex/issues/18335): slots leak across turns.
- [#26822](https://github.com/openai/codex/issues/26822): subagents can shut down without delivering results.
- [#23479](https://github.com/openai/codex/issues/23479): request for a capacity preflight. [#11999](https://github.com/openai/codex/issues/11999): `spawn_agent` hides the root cause as "not found".
- [#14841](https://github.com/openai/codex/issues/14841) (closed as not planned): an agent repeatedly spawns the same subagent instead of waiting.

### Inferences
- The issue pattern is consistent: delivery is tied to turn boundaries and to harness pollers, so the lead believes a message was received when it was only stored. "Send success" means written, not read. An orchestrator should track written, delivered, and acted-on as separate states.
- Slot accounting should key on worker process state, with explicit reclaim, and should expose capacity to the lead before a spawn. The Codex reports show the cost when the lead cannot see why a spawn failed.
- Terminal-based teams are the area with the most reported Claude failures (tmux panes vs process, pane-side polling). A PTY orchestrator shares this surface, but injection does not depend on a mailbox poller in the worker, so it avoids that specific failure class. This is untested reasoning, not a measured result.

### Gaps
- No vendor publishes failure rates or scale numbers for agent coordination. I found no measured success rate for any product.
- Fix state of most listed issues was not checked one by one; only #98998 and #22779 were opened and read. The rest come from search excerpts.
- Cursor and Copilot multi-agent failure reports were not searched. Their absence here says nothing about reliability.
- Official Jules docs were not found, so Jules is not covered.
