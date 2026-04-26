---
name: adversarial-review
description: Use this skill when the user asks to "adversarially review", "red-team", "stress-test a plan", "find gaps in plan", or "run reviewers on" a milestone plan / spec / RFC document. Dispatches four specialized reviewer subagents (consistency, gaps, feasibility, red-team) in parallel against a plan file, then synthesizes findings into a single severity-sorted report.
argument-hint: <plan-path>
allowed-tools: Read, Grep, Glob, Bash, Agent
---

# Adversarial Plan Review

Dispatch four parallel reviewer subagents against a milestone plan document, then synthesize their findings.

## When to use

User asks to adversarially review, red-team, stress-test, or find gaps in a plan, milestone, spec, or RFC document. Triggered explicitly via the slash command or implicitly when the user asks for an unusually thorough review of a planning document.

## Inputs

- **Argument**: path to the plan file (relative to repo root, or absolute). Resolve it before dispatching.
- If the user invokes the skill without an argument, ask for the plan path before doing anything else.

## Engy-specific context (preload into reviewer prompts)

This skill is project-local to the `engy` repo. When dispatching reviewers, pass the following context — these are the project's conventions and the concepts that have been deliberately removed in earlier planning rounds, so reviewers can grep for stale references and judge feasibility against the real stack.

- **REPO_ROOT**: `/Users/aleks/dev/engy`
- **STACK_DESCRIPTION**: "pnpm + Turborepo monorepo. `web/` = Next.js 16 (App Router) + custom Node HTTP server hosting tRPC API, WebSocket server, MCP server on a single port. `client/` = Node.js daemon on the developer's machine; connects to web via WebSocket; owns all filesystem and git operations. `common/` = shared TypeScript types only. Plugins under `plugins/<name>/{skills,agents}`. Drizzle/SQLite (in-memory for tests). Architectural rule: the server NEVER touches user repos directly — all FS and git ops go through the client daemon."
- **REMOVED_CONCEPTS** (grep for these as stale references): `log.md`, `lastIndexedSha`, file watcher, mtime/checksum tracking, daemon-driven git ops, `syncFromFiles`. If the plan being reviewed lists its own "Spec Drift" or "Rejected" section with additional removed concepts, add those to this list when dispatching the consistency reviewer.

If the user supplies their own override list for `REMOVED_CONCEPTS` (e.g., "review m7 with the m7-specific drift list"), use the user's list and skip the defaults.

## Procedure

### 1. Resolve and verify the plan path

- Resolve the argument to an absolute path. If the user gave a relative path, resolve it from the current working directory (typically `/Users/aleks/dev/engy/docs/projects/initial`).
- Read the file with the Read tool to confirm it exists and is a plan-shaped document. If it doesn't exist or looks unrelated, stop and tell the user.
- Skim for a one-line `<PLAN_SUMMARY>` to pass to reviewers (typically the H1 + the first paragraph of the Overview section).

### 2. Dispatch all four reviewers in parallel

Send a **single message with four Agent tool calls** so they run concurrently. Use the named subagents — do not use `general-purpose`.

| `subagent_type` | What to pass in the prompt |
|---|---|
| `consistency-reviewer` | `<PLAN_PATH>`, `<REMOVED_CONCEPTS>` |
| `gaps-reviewer`        | `<PLAN_PATH>`, `<PLAN_SUMMARY>` |
| `feasibility-reviewer` | `<PLAN_PATH>`, `<REPO_ROOT>`, `<STACK_DESCRIPTION>` |
| `redteam-reviewer`     | `<PLAN_PATH>`, `<PLAN_SUMMARY>` |

Each prompt should:

- State the absolute plan path.
- Inline the relevant context (don't ask the agent to look it up).
- Remind the agent to follow the output format defined in its system prompt (severity tags, line citations, word limit, no fixes).

Example prompt skeleton (consistency reviewer):

```
Adversarially review the plan at <PLAN_PATH> for internal consistency.

REMOVED_CONCEPTS to grep for as stale references:
<comma-separated list>

Follow the output format defined in your system prompt: severity-tagged findings, line citations, under 600 words, no fix proposals.
```

### 3. Synthesize findings

When all four have returned:

1. **Deduplicate.** Multiple reviewers often flag the same issue from different angles — that's signal it's real. Note overlap explicitly ("Flagged by consistency + red-team").
2. **Sort by severity.** CRITICAL → MAJOR → MEDIUM → MINOR. Within each bucket, group by source category (consistency / gaps / feasibility / red-team) for readability.
3. **Triage each finding** into one of three buckets:
   - **Fix in plan** — should be addressed before implementation begins.
   - **Out of scope** — legitimately not this plan's problem (note where it should live instead).
   - **Implementation detail** — acceptable to leave to the implementing engineer.
4. **Recommend next action.** Typical options: edit the plan to address CRITICAL/MAJOR fix-in-plan items now; defer MEDIUM/MINOR; punt out-of-scope to a follow-up RFC.

### 4. Present to the user

Output a single report with this shape:

```
# Adversarial review: <plan name>

## CRITICAL
- [source(s)] <finding> — <bucket>

## MAJOR
- ...

## MEDIUM
- ...

## MINOR
- ...

## Recommendation
<1–3 sentences>
```

Keep the report tight. The reviewers' verbose outputs are inputs, not the deliverable — your job is to compress them into something actionable.

## Important rules

- Always dispatch all four reviewers, even if one feels redundant for the plan at hand. Coverage > efficiency for this skill — that's the whole point.
- Do not mutate the plan file. This skill reviews; it does not edit.
- If a reviewer fails or returns nothing useful, note it in the synthesis ("redteam reviewer returned empty — re-run if needed") rather than silently dropping it.
- Use the project-local `REMOVED_CONCEPTS` defaults unless the user gives an override.
