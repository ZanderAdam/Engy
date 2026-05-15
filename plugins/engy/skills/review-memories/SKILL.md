---
name: engy:review-memories
description: Review unpromoted fleeting memories one by one. Proposes type/subtype/title/keywords/themes/tags, checks for duplicates and contradictions, and lets the user approve/edit/supersede/skip. Use during project completion or as ongoing maintenance.
---

# Review Memories

Batch-review unpromoted fleeting memories, enrich each one with LLM-proposed metadata, surface duplicates and conflicts, then promote, skip, or flag based on user choice.

## MCP Tools

- `mcp__Engy__listWorkspaces` — discover workspaceId when not known from context
- `mcp__Engy__listMemories({ workspaceId, compact: false })` — fetch all fleeting memories
- `mcp__Engy__search({ workspaceId, query, collection: 'memory', limit: 5 })` — find similar permanent memories
- `mcp__Engy__promoteMemory(...)` — promote approved fleeting to permanent (writes DB row + markdown file)
- `mcp__Engy__updatePermanentMemory({ id, ... })` — mark existing permanent as superseded via `supersededById`

## Process

### Step 1: Identify Workspace

Resolve the `workspaceId` from the current session/route context. If ambiguous, call `mcp__Engy__listWorkspaces` and ask the user which workspace to review.

### Step 2: Fetch Candidates

Call `mcp__Engy__listMemories({ workspaceId, compact: false })`. Filter the returned list client-side to entries where `promoted === false`. If no unpromoted memories exist, print "No unpromoted fleeting memories found." and stop.

Show a one-line header: `Found <N> unpromoted fleeting memories. Starting review...`

### Step 3: Iterate — One Candidate at a Time

For each candidate (sequential, NOT batched):

#### 3a. Enrich with LLM

Using your own reasoning (no extra API calls), propose:

- **subtype** — one of: `decision`, `pattern`, `fact`, `convention`, `insight`
- **title** — concise, ≤ 80 characters, describes the memory's core insight
- **keywords** — 3–8 low-level retrieval terms (specific nouns, method names, error codes)
- **themes** — 1–4 high-level conceptual areas (e.g. "error-handling", "auth", "performance")
- **tags** — 1–4 broader categorization labels (e.g. "architecture", "dx", "security")
- **repo** — if the memory is repo-specific, propose the matching repo name from the workspace's known repos; otherwise omit

#### 3b. Similarity Check

Call `mcp__Engy__search({ workspaceId, query: <fleeting.content>, collection: 'memory', limit: 5 })`.

Collect any results with a score above ~0.6 (or the top 2–3 if scores are not available). These are candidates for duplicate / supersession / contradiction.

#### 3c. Conflict Detection

Review the similar memories returned:

- **Supersession** — same topic, but the fleeting contains newer or corrected information → flag the existing permanent as potentially outdated.
- **Contradiction** — the fleeting directly contradicts a claim in an existing permanent → flag for the user.

#### 3d. Present to User

Print the candidate block then pause and wait for the user's action choice:

```
--- Candidate <N>/<total> ---
Content: <fleeting content, truncated to ~300 chars if longer>
Source:  <fleeting.source>
Created: <fleeting.createdAt>

Proposed metadata:
  subtype:  <decision|pattern|fact|convention|insight>
  title:    <Title>
  keywords: [term1, term2, ...]
  themes:   [theme1, ...]
  tags:     [tag1, ...]
  repo:     <repo name or none>

Similar existing memories:
  - <path>: <title> (score: <0.82>)   ← supersession risk if flagged
  - <path>: <title> (score: <0.71>)   ← contradiction if flagged
  (none found)

Conflicts detected: <none | supersedes '<existing title>' | contradicts '<existing title>'>

Action? [approve / edit / supersede / contradict / skip]
```

If the user types "stop", "done", or "exit", stop iterating immediately and jump to the Summary.

#### 3e: Handle the Action

**approve**
Call `mcp__Engy__promoteMemory` with:
```
{
  fleetingMemoryId: <id>,
  subtype: <proposed>,
  title: <proposed>,
  keywords: <proposed>,
  themes: <proposed>,
  tags: <proposed>,
  repo: <proposed or omitted>
}
```
Print: `Promoted → <permanent memory title>`

**edit**
Ask the user which fields to revise. Show the current proposed values; accept corrections. Re-display the revised block for confirmation, then call `mcp__Engy__promoteMemory` with the revised values.
Print: `Promoted (edited) → <permanent memory title>`

**supersede**
1. Call `mcp__Engy__promoteMemory` with proposed metadata → get back `permanentMemoryId`.
2. For each flagged existing permanent memory that this supersedes, call:
   `mcp__Engy__updatePermanentMemory({ id: <existing id>, supersededById: <new permanentMemoryId> })`
Print: `Promoted → <title>. Marked <existing title> as superseded.`

**contradict**
Do not promote and do not call any memory mutation. Print:
`Flagged as contradiction with <existing title>. Left unpromoted. Review manually.`
The fleeting remains in the DB; the contradiction note exists only in the session output.

**skip**
Do nothing. Print: `Skipped.`

### Step 4: Summary

After all candidates are processed (or the user stops early), print:

```
Review complete.

  Reviewed:      <N>
  Promoted:      <N>  (including edits and supersessions)
  Superseded:    <N>  existing memories marked as superseded
  Contradictions:<N>  flagged (left unpromoted)
  Skipped:       <N>
```

## Key Principles

- **Sequential only** — one candidate at a time; never batch multiple candidates in a single prompt.
- **LLM enrichment is in-context** — propose metadata using your own reasoning; no extra server-side LLM calls.
- **No project-status gate** — this skill works anytime: during project completion or as ongoing maintenance.
- **Contradict = do not promote** — flagging a contradiction leaves the fleeting untouched; the conflict note lives only in session output.
- **Supersede = promote first, then update** — always create the new permanent record before marking the old one superseded.

## Flow Position

**Typical trigger:** after `/engy:complete-project` distillation phase, or standalone maintenance.

**Next step (optional):** `/engy:propose-sysdocs` to surface patterns identified during review into system documentation.
