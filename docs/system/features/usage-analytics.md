---
description: Claude transcript scanning on the daemon, residual-cost attribution, sealed days, list-rate pricing, and the usage dashboard.
order: 17
---

# Claude Usage Analytics

Engy reads the local Claude Code transcripts, folds them into rollups, and shows where the tokens go. It answers two questions. The first is the cost, per day, per project and per session. The second is what caused the cost: which tool, which file, which tool input field.

The feature has three parts. The daemon scans the transcripts and returns rollups. The server stores the rollups in SQLite and prices them. The web app shows three screens over a shared date range.

## Data source

Claude Code writes one JSON object per line into `~/.claude/projects/<slug>/<sessionId>.jsonl`. The slug is the session `cwd` with each `/` replaced by `-`. A line that records an API call carries `message.usage` with the token buckets: `input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, `cache_creation.ephemeral_5m_input_tokens` and `server_tool_use`.

Subagent turns are not in the main transcript. Claude Code writes each one to a sidecar directory:

```
~/.claude/projects/<slug>/<sessionId>.jsonl                          main session
~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl     subagent transcript
~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.meta.json agent type and description
~/.claude/projects/<slug>/<sessionId>/tool-results/                  not transcripts
```

On the reference machine the subagent tier holds 86 % of the bytes and 77 % of the cost. A dashboard that reads only main transcripts reports less than a quarter of the total. The scan therefore walks both tiers. It never enters `tool-results/`, which holds tool payloads and no JSONL rows.

`~/.claude/usage-data/session-meta/<sessionId>.json` is a side input. The scan reads `first_prompt`, `duration_minutes`, `lines_added`, `lines_removed`, `files_modified`, `git_commits` and `tool_errors` from it to label and enrich a session row. It is not a token source: it has no cache fields, and it lags the transcripts.

## Where the work runs

The server never reads user files. The daemon does. Two facts forced the whole aggregation onto the daemon:

1. The WebSocket protocol has no chunked file read. One request gets one full response, and `dir.read` refuses more than 2 MB. A 54 MB transcript cannot cross the wire.
2. The transcript tree is 2.7 GB. A tool that loads it into memory runs out of heap.

So the daemon streams each file, keeps only the rollup, and sends the rollup. No transcript line ever crosses the channel.

`client/src/usage/scan.ts` walks the tree and reads each file with `createReadStream`. It buffers raw bytes and cuts each line at a newline it has seen. A trailing line that has no newline yet stays unread until a later scan. The scan holds one line at a time. `client/src/usage/reducer.ts` folds the lines into rollups. Its working set is the number of distinct dates, tools, fields, file paths and context items, not the size of the file. `client/src/ws/client.ts` `handleUsageScanRequest` joins the two to the protocol.

Before `JSON.parse`, the reducer runs a substring test (`lineMayMatter`). It skips a line that has no usage record, no content block and no attachment. On the reference machine it skipped 12 % of 534,111 lines (September 2026).

## The attribution model

Token totals give the cost. They do not say what caused it.

Every API call re-reads the whole conversation prefix. Content that enters the context at call `c`, in a session that makes `T` calls in total, is billed as a cache read `T - c` more times. The cost the content causes is therefore:

```
cost(block) = tokens(block) x (API calls that follow it) x cache read rate
```

`ResidualSum` in `client/src/usage/reducer.ts` keeps this as two running sums, so one pass over the file is enough.

**Attribution stops at a compaction boundary.** Auto-compaction replaces the prefix with a summary, so content added before it is no longer re-read. The reducer sees a compaction when the context collapses in one step: the context of a call is below 0.6 of the previous context, and the previous context was more than 60,000 tokens. At each boundary it settles every open accumulator at that call index and starts a new segment.

The cap is not a small correction. Without it, the model claims that cost concentrates in the first decile of a session. Measured cache-read cost is flat across deciles. The uncapped chart shows an artifact, not a trend.

**Images are priced from pixel count.** A base64 PNG in a tool result is about 1.26 M characters and bills about 1,800 tokens. `client/src/usage/tokens.ts` reads width and height from the PNG IHDR header (bytes 16 to 24 of the decoded prefix), scales the long edge down to 1568 px, and divides the pixel count by 750. A character-count estimate overstates a screenshot about 25 times and inverts the whole file cost ranking.

### Injected context

Claude Code adds context that is not a message content block. It writes this context as a top-level entry with `"type":"attachment"` and an `attachment` object. The entry has no `message` field. `attachment.type` names the kind:

| Kind | Model-visible text |
|---|---|
| `skill_listing` | `content` |
| `agent_listing_delta` | `addedLines` |
| `invoked_skills` | `skills[].content` and `skills[].name` |
| `nested_memory` | `content.content` (a CLAUDE.md file below the root) |
| `file` | `content.file.content` (a file that the prompt mentions) |
| `edited_text_file` | `snippet` |
| `hook_success` | `content` |
| `deferred_tools_delta` | `addedLines` |
| `queued_command` | `prompt` |
| `output_style`, `total_tokens_reminder`, `date_change`, others | their string fields |

Newer Claude Code versions also write three record kinds: `prompt_snapshot` (the system prompt and the tool schemas), `instructions` (the root CLAUDE.md files) and `deferred_tools_record` (the schemas of loaded deferred tools). They record context that the `baseline` cause already holds, and a file can hold more than one `prompt_snapshot`. The reducer skips them, so the cost is not counted twice.

The reducer charges each attachment as the `attachment` cause, with the same token-turns as a content block: it is inserted at the current call index and settled at a compaction. `client/src/usage/attachment.ts` `measureAttachment` estimates its tokens. The rule: sum the length of every string in the attachment, recursively through objects and arrays, and divide by 3.6 characters per token. The sum skips two groups of keys, listed in `METADATA_KEYS`. The first group is metadata: `type`, `uuid`, `source_uuid`, `toolUseID`, `timestamp`, `model`, `origin`, `commandMode`, `command`, `hookName`, `hookEvent`, `durationMs`, `exitCode`, `path`, `filePath`, `filename` and `displayPath`. The second group repeats other text. `stdout` repeats the hook `content`, and the model does not see the `stderr` of a hook that succeeds. The name lists repeat `addedLines` or `content`: `names`, `addedNames`, `addedTypes`, `removedNames`, `removedTypes`, `readdedNames`, `surfacedNames`, `skillNames`, `wireHiddenNames`, `pendingMcpServers` and `failedMcpServers`. Numbers and booleans count as zero.

The reducer also keeps one context-item row for each `(date, kind, label)`. The label is `path` for `nested_memory`, `filename` for `file` and `edited_text_file`, `hookName` for `hook_success`, and empty for every other kind. The row holds the count, the tokens and the token-turns. Its working set is bounded by the number of distinct items, like the file rollup.

On the reference machine, in a 15.7 MB session with two subagents, attachments came to 11 % of cache-read tokens. The largest items were the skill list, the output-style reminder (605 small copies), the agent list and a nested CLAUDE.md.

### Base context size

The reducer records `baseContextTokens`: the context of the first API call with a non-zero context (`cache_read + cache_creation + input`). It shows how large the context is before the session does any work. It includes the system prompt, the tool definitions, the root CLAUDE.md, the first attachments and the first prompt.

### Most cache-read cost belongs to no content block

With the compaction cap in place, content blocks come to about 0.30 of measured cache-read tokens. With attachments added, the 15.7 MB reference session came to about 0.50. The remainder is the per-call baseline that no transcript line records: the system prompt, the tool definitions and the root CLAUDE.md. It is re-read on every call. The transcripts do not contain it, so it cannot be split further.

So the dashboard reports seven causes:

| Cause | UI label | Source |
|---|---|---|
| `baseline` | System prompt and tools | measured cache-read cost minus the sum of the attributed causes |
| `toolResult` | Tool results | tool result content blocks |
| `toolInput` | Tool inputs | tool call input blocks |
| `text` | Replies | assistant text blocks |
| `image` | Images | image blocks in tool results |
| `thinking` | Thinking | thinking blocks |
| `attachment` | Injected context | `attachment` transcript entries |

`causesWithBaseline` in `web/src/server/trpc/routers/usage.ts` costs each attributed cause directly, at its own session's cache-read rate. It never scales them up to fill the measured total. Scaling would inflate every tool by about 3.3 times and send the user to fix the wrong thing. `baseline` is the remainder, floored at zero, so the seven always sum to the measured cache-read cost.

Measured usage stays the ground truth. Attribution only splits what was billed.

## Dates and sealed days

Every rollup row is dated by the local date of the line that produced it (`client/src/usage/date.ts`). Transcript timestamps are UTC. Bucketing by the UTC slice puts late-evening work on the wrong day, and in a UTC+ zone it can seal a date that local lines are still being written into. A session that runs across local midnight splits into one row per date, so a range query is exact at both ends.

`usageSealedDate` records each past date and the `USAGE_REDUCER_VERSION` of the last scan that sealed it. Rows of deleted transcripts can come from an older version. The server uses it to find rows that older reducer code computed (see Rebuild). A seal does not stop a scan from reading a line: a changed file is read in full, sealed dates included, because its session rows are replaced as one unit.

Transcript lines are append-only and chronological, and a resumed session appends lines stamped at resume time. No file can gain a line dated before today. `computeNewlySealedDates` therefore seals every date from the earliest first-line date up to, but not including, today. It does not stop at the oldest finished file. If it did, one long-finished session would hold the boundary back and no date would seal.

## Changed files

Each file is keyed by `(path, size, mtimeMs)` in `usageScanFile`.

- Same size and mtime: the scan skips the file.
- Any other size or mtime: the scan reads the file again from byte 0.

A read of the appended lines only is not correct. Content that an earlier read saw is re-read by every later API call. A new read starts each `ResidualSum` at call 0, so the calls after it would charge that content nothing. That cost would move into `baseline`. A reviewer compared reads of appended lines with full reads on real transcripts. The appended-lines reads kept 1 % to 79 % of the attachment token-turns, usually 5 % to 15 %. The other causes showed the same loss.

The server treats each scanned session as the whole file. `clearSessionRollups` deletes that session's rows first, and the new rows replace them. Daemon scan times on the reference machine (1,543 files, 2.4 GB, September 2026): 15 s for the first read of all files, 40 ms when no file changed, and 0.4 s when only the largest file (62.5 MB) changed.

## Schema

All tables are in `web/src/server/db/schema.ts`. Token counts are integers. Money is integer micro-cents in the row and integer cents in the response.

| Table | Key | Holds |
|---|---|---|
| `usageScanFile` | `path` | size, mtime, first and last line date |
| `usageSealedDate` | `date` | seal time, reducer version |
| `usageSession` | `sessionId` | one row per session, including subagents, with tokens, cost, base context size and enrichment |
| `usageSessionDaily` | `(date, sessionId, model)` | the time series the charts read |
| `usageTool` | `(date, sessionId, toolName)` | calls, result size, attributed cost |
| `usageField` | `(date, sessionId, tool, field)` | cost per tool input field |
| `usageFile` | `(date, sessionId, filePath)` | reads, edits, writes, attributed cost |
| `usageCause` | `(date, sessionId, kind)` | token-turns per cause |
| `usageContextItem` | `(date, sessionId, kind, label)` | count, tokens, token-turns and attributed cost per injected context item |
| `usageCall` | `(sessionId, callIndex)` | the context-growth series |
| `usageExpensiveCall` | `(date, sessionId, callIndex)` | the top 20 tool calls of each session, with a short input preview |
| `usagePricing` | `model` | rates as integer micro-cents per token |

`date` is part of every rollup key, not `sessionId` alone. Sessions run for hours and cross midnight, so a session-only key forces a range query to take a whole session or drop it, and both are wrong at the edges.

### Grouping

`repoRoot` is derived on the daemon. It walks up from `cwd` to the nearest directory that holds `.git`, then collapses a `<repo>/.claude/worktrees/<name>` root back to `<repo>`. The server matches `repoRoot` against the workspace `repos` list to fill `engyWorkspaceId` and `engyProjectId`. A session that matches no workspace keeps its rows and stays visible; the join never drops a row.

The overview groups by `repoRoot` or by the raw slug, under a toggle.

## Pricing

`web/src/server/usage/pricing.ts` holds the seed rates in `SEED_MODEL_RATES` and writes them to `usagePricing` as integer micro-cents per token. `seedUsagePricing` runs at server start (`web/server.ts`). The table is seeded but editable, so a rate change is a row update and not a deploy.

Rates in dollars per MTok:

| Model | Input | Output | Cache write 1h | Cache write 5m | Cache read |
|---|---|---|---|---|---|
| `claude-opus-5-5` | 4.00 | 20.00 | 8.00 | 5.00 | 0.20 |
| `claude-opus-5` | 5.00 | 25.00 | 10.00 | 6.25 | 0.50 |
| `claude-fable-5-1` | 10.00 | 50.00 | 20.00 | 12.50 | 0.25 |
| `claude-fable-5` | 10.00 | 50.00 | 20.00 | 12.50 | 1.00 |
| `claude-sonnet-5` | 2.00 | 10.00 | 4.00 | 2.50 | 0.20 |
| `claude-haiku-4-5` | 1.00 | 5.00 | 2.00 | 1.25 | 0.10 |

The usual rule is: cache write 5m is 1.25 times input, cache write 1h is 2 times input, cache read is 0.1 times input. There are two exceptions: `claude-fable-5-1` at 0.025 times input, and `claude-opus-5-5` at 0.05 times input. A hardcoded 0.1 rule would make the cache-read cost of `claude-fable-5-1` four times too high, and the cache-read cost of `claude-opus-5-5` two times too high.

Transcripts stamp a dated snapshot id, such as `claude-haiku-4-5-20251001`, for a model the table lists undated. `normaliseModelId` removes a trailing eight-digit date before the lookup. A model with no row keeps its tokens and is listed in `unpricedModels`. It is never priced at zero and never priced with a guessed rate.

Money is integer cents at the API boundary. Each row stores micro-cents and the router rounds once, after it sums. Rounding per row would zero most sub-cent rows before the sum. Every dollar figure in the UI is labelled as an estimate at API list rates, because subscription billing is not per token.

## Rebuild

Migration `0034_usage_analytics.sql` is additive: twelve `CREATE TABLE` statements and no `DROP` or `ALTER`. It cannot remove rows an earlier schema wrote.

A rebuild derives the rows again from the transcripts that are still on disk. Claude Code deletes transcripts older than 30 days by default (`cleanupPeriodDays`). A rebuild therefore never deletes rollup rows. `rebuildUsageHistory` in `web/src/server/usage/rebuild.ts` clears only `usageScanFile` and `usageSealedDate`. The next scan then reads every file on disk in full, and each of those sessions replaces its own rows. The rows of a session whose file is gone stay as they are. A rebuild leaves `usagePricing` alone: it is configuration, not history.

Two paths start a rebuild:

- `hasStaleReducerSeals` runs at the start of every refresh. It looks for a sealed date with a `USAGE_REDUCER_VERSION` other than the current one. If it finds one, the refresh asks the daemon for a scan with no known files and no sealed dates. It clears the bookkeeping in the same transaction that stores the scan. Raise `USAGE_REDUCER_VERSION` when the attribution model or the token estimate changes. If you do not, a fixed bug never reaches the stored rows.
- `usage.rebuild` is the manual form, with no version check. It clears the bookkeeping at once, and the next refresh reads every file.

### Daemon version

`pnpm cycle-web` restarts only the server, so a daemon with older code can still run. Its rollups can lack fields that the server reads, or come from replaced logic. The daemon therefore sends `reducerVersion` in each scan response. The server compares it with its own `USAGE_REDUCER_VERSION` before it deletes, stores or seals anything. If the two are different, or the response has no version, the refresh fails with this message: "The Engy daemon runs an older usage scanner (version X, server needs Y). Restart the daemon, then refresh."

One number is the source of truth. `common/src/usage/types.ts` declares the literal type `UsageReducerVersion`. The server (`web/src/server/usage/rebuild.ts`) and the daemon (`client/src/usage/reducer.ts`) each declare `USAGE_REDUCER_VERSION` with that type. A bump on one side does not compile until the other side and the type agree.

## UI

Routes are `web/src/app/w/[workspace]/usage/page.tsx` and the project-scoped variant at `web/src/app/w/[workspace]/projects/[project]/usage/page.tsx`. `web/src/components/usage/usage-page.tsx` holds the three views and the shared controls. Charts use `recharts`.

One date-range picker in the header applies to every screen, chart and table. The range lives in the URL as `?from=YYYY-MM-DD&to=YYYY-MM-DD`, so a view is linkable and survives a reload. A preset resolves to dates before it is written, so a shared link means the same window tomorrow. The default is the last 30 days. Each stat tile compares against the window of equal length that ends the day before the range starts.

- **Overview** (`overview-screen.tsx`) — stat tiles, the stacked cost area chart, the per-project bar chart, the main-session against subagent split, the seven-cause breakdown, and the cache reuse panel. The cache reuse panel shows `cacheReadTokens / cacheCreationTokens`, the tokens read from cache for each token written. It does not warn about 1h writes.
- **Cost by cause** (`burn-screen.tsx`) — the tool table, the tool input field table, the file table, the injected context table and the highest cost calls table. Each table is a tab in one panel. The injected context table (`context-item-table.tsx`) shows the kind, the item (file path or hook name), the cost, the tokens and the count. Tools sort by attributed cost, and the table also shows cost per call. Files group by path, extension or directory. A row in the highest cost calls table opens its session.
- **Sessions** (`sessions-screen.tsx`, `session-detail.tsx`) — sessions listed by cost, calls or recency, with the subagent cost rolled into the parent row. The detail view shows that session's context-growth curve with its base context size, then its subagents, tools, fields, files and injected context as tabs in one panel.

A scope picker in the header holds `?scope=all|workspace|project`. `all` queries every scanned session and is the default on the workspace route, because a session carries an `engyWorkspaceId` only when its repo root matched a workspace repo at scan time. A narrower default shows an empty dashboard on any machine where no repo matched. The project route defaults to `project`.

`usage.refresh` is on-demand, with a manual refresh button. There is no poller: a refresh reads only the files that changed. A refresh with no daemon connected returns an empty result instead of an error. A Rebuild button beside it, behind a confirm dialog, makes the next refresh read every transcript again. Both rely on the `USAGE_CHANGE` broadcast to refresh every open tab.

## Out of scope

No per-token invoice: the figures are estimates at list rates. No poller. No retention or roll-off policy. No write back to the transcripts.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-USAGE-010 | WHEN the daemon reads a transcript file, the system SHALL read it as a line-oriented stream and hold one line at a time. The system SHALL NOT read a whole transcript file into memory, and the reducer's working set SHALL be bounded by the number of distinct rollup groups rather than by file size. |
| FR-USAGE-020 | WHEN the reducer receives a transcript line, the system SHALL apply a substring test for a usage marker, a content-block marker or an attachment marker before `JSON.parse`, and SHALL count a line that fails the test as skipped. |
| FR-USAGE-030 | IF a transcript line is not valid JSON, THEN the system SHALL count it as skipped and SHALL continue the scan. |
| FR-USAGE-040 | WHEN the daemon lists transcript files, the system SHALL read `<slug>/<sessionId>.jsonl` as a main transcript and every `<slug>/<sessionId>/subagents/*.jsonl` as a subagent transcript, and SHALL NOT read the sibling `<slug>/<sessionId>/tool-results/` directory. |
| FR-USAGE-050 | WHEN the daemon scans a subagent transcript, the system SHALL set `isSubagent` to true and `parentSessionId` to the owning session id, and SHALL read `agentType` and `agentDescription` from the `agent-<id>.meta.json` sidecar; IF the sidecar is absent or unreadable, THEN both SHALL be null and the scan SHALL continue. |
| FR-USAGE-060 | WHEN `usage.sessions` returns a main session, the system SHALL add the cost and API calls of its subagent rows to that row and report them separately as `subagentCostCents` and `subagentCalls`; the system SHALL list subagent rows on their own only WHERE `includeSubagents` is true. |
| FR-USAGE-070 | IF a subagent row names a parent session that has no row, THEN the system SHALL list that row as a top-level session with its own cost, and SHALL NOT drop it. |
| FR-USAGE-080 | WHEN the reducer measures an image block, the system SHALL read the width and height from the PNG IHDR header, scale the long edge down to 1568 px, and estimate the tokens as the resulting pixel count divided by 750; the system SHALL NOT estimate an image from its payload length. IF the dimensions cannot be read, THEN the system SHALL use a fixed estimate of 1500 tokens. |
| FR-USAGE-090 | The system SHALL charge each content block its token count once for every API call that follows it in the session, and SHALL charge nothing to content added after the last call. |
| FR-USAGE-095 | WHEN the reducer reads a transcript entry with `type` `attachment`, the system SHALL charge it as the `attachment` cause with the same token-turns rule as a content block, including the stop at a compaction. The system SHALL estimate its tokens from the sum of the lengths of all string values in the attachment, found recursively, at 3.6 characters per token, and SHALL skip metadata keys and keys that repeat other text (`stdout`, `stderr`, and the name lists). The system SHALL NOT charge the record kinds `prompt_snapshot`, `instructions` and `deferred_tools_record`. |
| FR-USAGE-097 | WHEN the reducer charges an attachment, the system SHALL add it to one context-item row for each date, kind and label. The kind SHALL be `attachment.type`. The label SHALL be `path` for `nested_memory`, `filename` for `file` and `edited_text_file`, `hookName` for `hook_success`, and empty for every other kind. |
| FR-USAGE-100 | WHEN the context of an API call is below 0.6 of the previous call's context AND the previous context was above 60,000 tokens, the system SHALL count one compaction and SHALL stop charging every open block at that call index; a block added after the boundary SHALL be charged only against the calls that follow it. |
| FR-USAGE-110 | The system SHALL cost each attributed cause from its own token-turns at its session's cache-read rate (the rate of the model with the most calls that bill tokens), SHALL NOT scale the attributed causes up to fill the measured total, and SHALL report the remaining measured cache-read cost as the separate `baseline` cause. |
| FR-USAGE-120 | The system SHALL make the seven causes `toolResult`, `toolInput`, `text`, `image`, `thinking`, `attachment` and `baseline` sum exactly to the reported cache-read cost; IF the attributed causes exceed the measured cost, THEN `baseline` SHALL be 0 and SHALL NOT go negative. |
| FR-USAGE-130 | The system SHALL store each row's attributed cost as integer micro-cents, SHALL sum micro-cents before it rounds, and SHALL round once to an integer cent at the API boundary; every money value returned by the `usage` router SHALL be an integer number of cents. |
| FR-USAGE-135 | WHEN the server stores a scanned session, the system SHALL price each day of the session at the rate of the model that ran that day, so a session that changes model is not priced at one model's rate. |
| FR-USAGE-140 | IF a model id has no row in `usagePricing` and has billed tokens, THEN the system SHALL keep that model's token counts in the totals, SHALL report the id in `unpricedModels`, and SHALL NOT price it at zero or with a guessed rate. A model with no billed tokens, such as `<synthetic>`, SHALL NOT be reported. |
| FR-USAGE-150 | WHEN the system looks up a model rate, it SHALL first remove a trailing eight-digit date suffix from the model id, so a dated snapshot of a priced model is priced at the base model's rate. |
| FR-USAGE-160 | WHEN the pricing seed runs, the system SHALL write each seed rate to `usagePricing` as integer micro-cents per token, and SHALL NOT overwrite a rate that is already stored. |
| FR-USAGE-170 | The system SHALL date every rollup row by the local date of the transcript line that produced it, so a session that crosses local midnight produces one row per date and a range query includes only the rows inside the range. |
| FR-USAGE-180 | WHEN a scan ends, the system SHALL report as newly sealed every date from the earliest scanned line up to, but not including, the current local date, excluding dates already sealed; the system SHALL never seal the current local date. |
| FR-USAGE-200 | WHEN the daemon finds a transcript file whose stored size and mtime are unchanged, the system SHALL skip the file without reading it. |
| FR-USAGE-205 | WHEN the daemon finds a transcript file whose size or mtime differs from the stored state, the system SHALL read the file again from byte 0 and SHALL pass every line to the reducer, including a line on a sealed date, so the rollups cover the whole file. The system SHALL NOT resume a read at a stored byte offset. |
| FR-USAGE-210 | WHEN the server stores a scanned session, the system SHALL delete that session's rollup rows first, so the new rows replace them and are not added to them. |
| FR-USAGE-215 | The system SHALL record for each session `baseContextTokens`, the context size (`cache_read + cache_creation + input`) of the first API call with a non-zero context. `usage.session` SHALL return it. |
| FR-USAGE-220 | WHEN the daemon has a session `cwd`, the system SHALL set `repoRoot` to the nearest ancestor directory that holds `.git`, and SHALL collapse a `<repo>/.claude/worktrees/<name>` root back to `<repo>`; IF no `cwd` was recorded, THEN `repoRoot` SHALL be null. A session that matches no Engy workspace SHALL keep its rows and stay visible. |
| FR-USAGE-230 | The system SHALL record at most 200 context-growth points per session; WHEN the buffer is full, the system SHALL keep every second point and double the sampling stride, so the series stays ordered and spans the whole session. |
| FR-USAGE-240 | IF no daemon is connected, THEN `usage.refresh` SHALL return `scannedFiles` 0 and `newSessions` 0 without an error. |
| FR-USAGE-245 | WHEN a usage scan response arrives, IF its `reducerVersion` is absent or differs from the server's `USAGE_REDUCER_VERSION`, THEN the system SHALL reject the refresh with a `PRECONDITION_FAILED` error that names both versions and tells the user to restart the daemon. The system SHALL make this check before it deletes, stores or seals any usage row. |
| FR-USAGE-250 | WHEN a usage scan response arrives, the system SHALL write every session, day, tool, field, file, cause, context-item, call and expensive-call row in one transaction, and SHALL broadcast a `USAGE_CHANGE` event. |
| FR-USAGE-260 | WHEN a refresh starts, IF any sealed date carries a reducer version other than the current `USAGE_REDUCER_VERSION`, THEN the system SHALL request a scan with no known files and no sealed dates, and SHALL delete every usage scan-bookkeeping row in the transaction that stores that scan. The system SHALL keep the rollup rows of each session that the scan does not report, and SHALL leave `usagePricing` unchanged. |
| FR-USAGE-270 | WHEN `usage.overview` is queried for a range, the system SHALL also return the cost of the window of equal length that ends on the day before the range starts. |
| FR-USAGE-280 | WHEN `usage.tools` is queried, the system SHALL return tools sorted by attributed cost, highest first, with the cost per call for each tool. |
| FR-USAGE-290 | WHEN `usage.fields` is queried, the system SHALL group the attributed cost by tool and by tool input field name, and SHALL sum all rows that share a `tool.field` before it rounds to cents. |
| FR-USAGE-300 | WHEN `usage.files` is queried, the system SHALL group the rows by full path, by extension, or by directory, as `groupBy` selects. |
| FR-USAGE-305 | WHEN `usage.contextItems` is queried, the system SHALL return the injected context items in the range and scope, with one row per kind and label summed across dates and sessions before it rounds to cents, sorted by cost, highest first, and limited to `limit` rows. |
| FR-USAGE-310 | WHEN `usage.session` is queried, the system SHALL return that session's tool, file, field, context-item, subagent and context-growth breakdowns, with one tool row per tool, one field row per tool and field, one file row per path, and one context-item row per kind and label, each summed across all dates of the session; IF the session id is unknown, THEN the system SHALL raise a `NOT_FOUND` error. |
| FR-USAGE-320 | The usage page SHALL hold its date range in the URL as `from` and `to`, SHALL resolve each preset to inclusive local dates before writing them, and SHALL fall back to the last 30 days IF the range is absent, malformed or inverted. |
| FR-USAGE-330 | WHEN `usage.overview` is queried, the system SHALL include the subagent cost in the total and SHALL also report it as `subagentCost` and as a share of the total. |
| FR-USAGE-340 | The overview SHALL report cache reuse as `cacheReadTokens / cacheCreationTokens`, and SHALL NOT warn about the use of the 1h cache TTL by itself. |
| FR-USAGE-350 | The system SHALL hold at most 20 expensive calls for each session. The system SHALL rank them by settled token-turns when the session ends, and SHALL NOT rank them when a call is admitted, because a later compaction can still lower the cost of a call. WHEN `usage.expensiveCalls` is queried, the system SHALL return the rows in the range sorted by token-turns, highest first. |
| FR-USAGE-360 | WHEN `usage.rebuild` is called, the system SHALL delete every usage scan-bookkeeping row (`usageScanFile` and `usageSealedDate`), so the next scan reads every transcript on disk in full. The system SHALL NOT delete a rollup row, because Claude Code deletes old transcripts and the rows of a deleted transcript cannot be derived again. The system SHALL leave `usagePricing` unchanged and SHALL broadcast a `USAGE_CHANGE` event. |
| FR-USAGE-370 | The usage page SHALL hold its scope in the URL as `scope=all`, `scope=workspace` or `scope=project`. WHERE the scope is `all`, the system SHALL apply no workspace filter and no project filter, so a session whose repository matched no Engy workspace stays visible. The workspace route SHALL use `all` as its default scope. The project route SHALL use `project` as its default scope. |
| FR-USAGE-380 | WHEN `usage.refresh` is called with `since`, the system SHALL scan only the transcript files whose local mtime date is on or after that date. IF the system skips a file for this reason, THEN it SHALL NOT record that file as scanned, so a later scan reads the file in full. A scan with `since` SHALL seal no date. |
| FR-USAGE-390 | The system SHALL hold at most 1000 unmatched tool calls in the map that pairs a tool call with its result, because an interrupted call never receives the result that removes it. WHEN the map is full, the system SHALL remove the oldest unmatched entry. IF a tool result has no entry in the map, THEN the system SHALL leave that result unattributed, and SHALL NOT attribute it to a different tool. |
| FR-USAGE-400 | The system SHALL compute the p50 and p95 result size of each tool from a reservoir sample of at most 256 values for that tool, so the memory used stays proportional to the number of tools and not to the number of tool calls. The system SHALL report the two percentiles as approximate values across sessions. |

## Sources

No prior knowledge found.
