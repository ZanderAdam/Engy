---
description: Protocol for agents to pause execution and ask the user batched questions, then resume automatically on answer.
order: 13
---

# Agent Question Protocol

Agents running inside Engy sessions can pause mid-task to ask the user up to four batched questions before continuing. The protocol has two halves: the agent-facing MCP tool that creates the question batch and blocks the task, and the user-facing tRPC mutation that records the answers and triggers an automatic resume of the agent session.

## Components

**MCP surface — `askQuestion` (`web/src/server/mcp/index.ts`, `registerQuestionTools`).**
The agent calls `askQuestion` with a `sessionId`, an optional `taskId`, and 1–4 question items. Each item carries a `question` text, a short `header` chip label (max 12 chars), an `options` array (each option has `label`, `description`, and an optional `preview` markdown field), and an optional `multiSelect` flag. Optional top-level fields `documentPath` and `context` attach document context for the UI. A zod `.min(1).max(4)` constraint enforces the batch size before the handler runs.

Inside the handler, a single SQLite transaction inserts one row per question item into the `questions` table (`web/src/server/db/schema.ts`, lines 158–173) and — when `taskId` is present — sets `tasks.subStatus = 'blocked'` on the corresponding task row. The tool then returns `{ status: 'blocked', questionIds: number[] }` so the agent knows to wait.

**DB schema — `questions` table.** Columns: `id`, `taskId` (nullable FK to `tasks`, `onDelete: 'set null'`), `sessionId` (not null), `documentPath`, `context`, `question`, `header`, `options` (JSON array of `QuestionOption`), `multiSelect` (boolean, default false), `answer`, `createdAt`, `answeredAt`.

**tRPC surface — `questionRouter` (`web/src/server/trpc/routers/question.ts`).**
Four procedures:

- `list` — returns questions filtered by optional `taskId`, `sessionId`, and/or `unanswered` flag.
- `get` — returns a single question by id with an attached `taskContext` (task title + description) when the question has a `taskId`.
- `submitAnswers` — the mutation a user or UI invokes to answer a pending batch.
- `unansweredCount` / `unansweredByTask` — read-only aggregate queries for UI badge counts.

**`submitAnswers` flow.** The mutation groups questions by `(taskId, sessionId)` (falling back to `sessionId` alone when `taskId` is absent), validates that the submitted answer count matches the unanswered count for that group exactly, then runs a transaction to set `answer` + `answeredAt` on each row and clear `tasks.subStatus` from `'blocked'` to `null`. After the transaction it locates the latest `agentSessions` row for the task or session, resets its `status` to `'active'`, constructs a resume prompt (`"Your questions have been answered:\n\nQ: ...\nA: ...\nContinue with the task."`), and dispatches `EXECUTION_START_REQUEST` with `[...baseFlags, '--resume', latestSession.sessionId]` via `dispatchExecutionStart` in `web/src/server/ws/server.ts`. The original `agentSessions` row is reused — no new row is inserted — so `claude --resume` appends to the existing JSONL conversation file.

If `dispatchExecutionStart` throws (daemon absent or crashed), the handler marks the session `status = 'stopped'`, sets `tasks.subStatus = 'failed'`, broadcasts both a `QUESTION_CHANGE` and a `TASK_CHANGE` event, then re-throws `INTERNAL_SERVER_ERROR`.

**Broadcasts — `broadcastQuestionChange` (`web/src/server/ws/broadcast.ts`, lines 106–115).** A `QUESTION_CHANGE` event (`{ action, taskId?, sessionId? }`) is emitted over `/ws/events` in two moments: after `askQuestion` inserts rows (`action: 'created'`), and after `submitAnswers` completes (or fails) (`action: 'answered'`). Connected browser clients use this to refresh question badge counts and show/hide the question panel without polling.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-QUESTION-010 | WHEN the `askQuestion` MCP tool is called with 1–4 question items, the system SHALL insert one `questions` row per item in a single transaction and return `{ status: 'blocked', questionIds }`. |
| FR-QUESTION-020 | IF the `askQuestion` call supplies a `taskId`, THEN the system SHALL set `tasks.subStatus = 'blocked'` for that task within the same insert transaction. |
| FR-QUESTION-030 | IF the `askQuestion` call provides fewer than 1 or more than 4 question items, THEN the system SHALL reject the call with a validation error before any database write occurs. |
| FR-QUESTION-040 | WHEN `submitAnswers` receives a number of answers different from the count of unanswered questions in the same `(taskId, sessionId)` group, the system SHALL throw a `BAD_REQUEST` error with message `"Partial submission: expected N answers, got M"`. |
| FR-QUESTION-050 | WHEN `submitAnswers` receives a complete answer set, the system SHALL record `answer` and `answeredAt` on each question row and clear `tasks.subStatus` to `null` in a single transaction. |
| FR-QUESTION-060 | WHEN `submitAnswers` completes its transaction and a matching `agentSessions` row exists, the system SHALL reset that row's `status` to `'active'` and `completionSummary` to `null`, then dispatch `EXECUTION_START_REQUEST` with `--resume <sessionId>` reusing the original session row. |
| FR-QUESTION-070 | IF `dispatchExecutionStart` throws during `submitAnswers`, THEN the system SHALL mark the `agentSessions` row `status = 'stopped'`, set `tasks.subStatus = 'failed'`, broadcast `QUESTION_CHANGE` and `TASK_CHANGE`, and throw `INTERNAL_SERVER_ERROR`. |
| FR-QUESTION-080 | WHEN `askQuestion` completes or `submitAnswers` completes, the system SHALL emit a `QUESTION_CHANGE` event over `/ws/events` with the corresponding `action` (`'created'` or `'answered'`). |
| FR-QUESTION-090 | WHEN `unansweredCount` is called, the system SHALL return the number of distinct `coalesce(taskId, sessionId)` groups that have at least one unanswered question, optionally scoped to a project. |
| FR-QUESTION-100 | WHEN `unansweredByTask` is called, the system SHALL return a map of `taskId → unanswered question count` for all tasks with at least one unanswered question, optionally scoped to a project. |

## Sources

No prior knowledge found.
