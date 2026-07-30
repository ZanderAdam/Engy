---
name: session-distill
description: This skill should be used when the user asks to "distill this session", "save session learnings", "capture learnings from this session", "what's worth remembering from this session", "session distill", or "extract memories from this session". Reflects over the current conversation, extracts 1–3 atomic, non-obvious learnings the code and commits won't capture, and drafts them as fleeting memories into the review-memories queue — no source snapshot.
---

# Session Distill

Mine the current session for durable knowledge and draft it as fleeting memories. A session is a good *mine* but a bad *artifact*: most of it is ephemeral, and the parts worth keeping that already live in code, commit messages, or diffs do not need a memory. This skill extracts only the small residue a future reader could not recover by reading the repo — decisions made in conversation, gotchas found by trial-and-error, and rejected approaches with their rationale.

Unlike `engy:ingest`, this skill never writes a source snapshot and never commits a transcript. It produces lightweight, atomic fleeting memories that join the standard `engy:review-memories` promotion lifecycle, human-gated at every step.

## MCP Tools

- `listWorkspaces` — resolve `workspaceId` when not known from context
- `createFleetingMemory` — draft each approved distillation (DB row, `promoted: false`)

## Core Principle: Distill, Don't Snapshot

The signal-to-noise ratio of a raw session is brutal. A dense hour typically yields **one** memory worth keeping. Resist the urge to summarize the whole conversation. Capture the few claims that are both *non-obvious* and *not already recorded elsewhere*, then stop.

## Selection Filter

Apply this filter to every candidate before drafting it. When in doubt, drop it — a missed learning costs little; a noisy memory degrades retrieval for every future query.

**Keep** (not recoverable from the repo):
- **Decisions made in conversation** — "chose X over Y because Z", where Z lives only in the discussion.
- **Gotchas found the hard way** — surprising tool/library/environment behavior that cost real trial-and-error.
- **Rejected approaches** — what was tried, why it failed, what replaced it.
- **Conventions discovered** — an implicit rule not enforced by linters/types and not written in CLAUDE.md.

**Skip** (already recorded, or ephemeral):
- Anything captured by the **code comment, commit message, or diff** of work done this session.
- Step-by-step narration of what happened, exact command sequences, or tool output.
- Transient state (merge in progress, which file was open, a flaky run that resolved).
- Restatements of existing memories or CLAUDE.md content.

See `references/selection-criteria.md` for worked keep-vs-skip examples drawn from real sessions.

**Boundary — Engy knowledge layer vs. harness memory.** This skill writes to the Engy workspace knowledge layer. A learning that is purely about *how Claude should operate* (tool quirks, testing technique, workflow preference) often belongs in the harness per-project memory at `~/.claude/projects/<slug>/memory/` instead. If a candidate is operational-for-Claude rather than domain/product knowledge, flag it during confirmation (Step 4) and let the user decide where it lands — do not force it into the knowledge layer.

## Process

### Step 1: Identify Workspace

Resolve `workspaceId` from the current session/route context. If ambiguous, call `listWorkspaces` and ask which workspace to capture into.

### Step 2: Scan the Session

The current conversation is already in context — no tool fetches it. Re-read the session and list every candidate learning, then immediately run each through the Selection Filter. Produce a shortlist of **at most 3** survivors. If nothing survives, print "No durable learnings to capture — everything from this session is already in the code, commits, or existing memory." and stop. Reporting nothing is a valid, common outcome.

### Step 3: Draft Atomic Distillations

For each survivor, draft a four-part body (matching `engy:ingest` distillations for consistency). **Atomicity rule (load-bearing for retrieval):** one central claim per memory. Do not fold a second claim in with "and"/"also" — split it into a separate candidate or drop it. Do not restate a sibling fact that belongs in its own memory; point to it in "Connects to" instead.

```
**Core claim:** <the single most important assertion>

**What surprised:** <what was non-obvious or cost trial-and-error>

**Connects to:** <related topics, decisions, or existing notes — name them>

**Contradicts:** <any prior position or note this conflicts with, or "nothing identified">

Session: <session id if known from context, else "session YYYY-MM-DD">
```

Derive tags: always include `'session-distill'`; add a repo short-name tag when the learning is repo-scoped, and a doc-class tag (`'convention'`, `'decision'`, etc.) where unambiguous. Do not invent rich per-memory tags — `engy:review-memories` proposes those at promotion.

### Step 4: Confirm With the User (Human Gate)

Present the shortlist before creating anything. For each candidate show: the proposed core claim, its tags, and whether it reads as **domain knowledge** (→ Engy knowledge layer) or **operational-for-Claude** (→ may belong in harness memory). Let the user approve, edit, reclassify, or drop each one. Only approved, domain-bound candidates proceed to Step 5.

### Step 5: Create Fleeting Memories

For each approved candidate, call:

```
createFleetingMemory({
  workspaceId: <id>,
  type: 'capture',
  source: 'agent',
  tags: ['session-distill', ...<derived tags>],
  content: <four-part body from Step 3>
})
```

Note: `source` has no `'session'` value (enum is `agent | user | system`) and there is no session-id parameter — that is why provenance rides in the `tags` and the `Session:` line of the body. Record each returned memory `id` for the summary.

### Step 6: Hand Off

Do **not** reindex and do **not** commit anything — fleeting memories are surfaced by `engy:review-memories` via `listMemories`, not search, so no index update is needed, and promotion (not this skill) writes the durable markdown file.

## Output Format

```
Session distill complete.

  Scanned:    <N> candidates, <M> survived the filter
  Created:    fleeting #<id> — <core claim, truncated>   [tags]
              fleeting #<id> — <core claim, truncated>   [tags]
  Deferred:   <K> flagged as operational → suggested for harness memory (not created here)

Next: run /engy:review-memories to promote these when ready.
```

## Key Principles

- **One memory is a good session.** Three is a lot. Zero is common and fine.
- **The session is a mine, not an artifact** — never snapshot or commit the transcript.
- **No auto-promotion** — drafts join `engy:review-memories`; this skill never promotes.
- **Human-gated** — propose before creating; the user is the arbiter of what is worth keeping.
- **Respect the memory boundary** — operational-for-Claude learnings may belong in harness memory, not the knowledge layer.

## Flow Position

**Typical trigger:** the user wraps up a working session and wants its durable learnings captured.

**Next step:** `/engy:review-memories` — promotes the drafted distillations when the user is ready.
