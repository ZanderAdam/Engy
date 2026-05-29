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

- **subtype** — one of: `decision`, `pattern`, `fact`, `convention`, `insight`. Match the shape of the claim:
  - `decision` — "we chose X over Y because Z"
  - `pattern` — "how X works, the recurring shape"
  - `fact` — "X is true / X exists / X has these properties"
  - `convention` — "the team rule / when to do X"
  - `insight` — "something non-obvious / a learning / a gotcha"
- **title** — concise, ≤ 80 characters, describes the memory's core insight
- **keywords** — 3–8 low-level retrieval terms (specific nouns, method names, error codes). **Atomicity rule:** keywords should be terms that are *central to this memory's claim*, not terms that happen to appear in the body but belong in a sibling memory. Example: a memory titled "M2 added per-workspace docsDir" should NOT list `ENGY_DIR` as a keyword even if its body mentions ENGY_DIR — that keyword belongs in a separate `engy-dir-defaults` memory.
- **themes** — 1–4 high-level conceptual areas (e.g. "error-handling", "auth", "performance")
- **tags** — 1–4 broader categorization labels (e.g. "architecture", "dx", "security"). **Preserve** ingest-applied tags (milestone like `m7`, repo, doc-class) — don't drop them during promotion; user filtering depends on consistent tag taxonomy.
- **repo** — if the memory is repo-specific, propose the matching repo name from the workspace's known repos; otherwise omit

#### 3a-bis. Atomicity check (block promotion if violated)

Before proposing metadata, scan the fleeting body for content that doesn't support the central claim:

- **Sibling-context bleed:** the body restates a fact or decision that has (or should have) its own memory. Example: a memory about diff-viewer UI that also explains how the daemon serves git ops — the daemon facts belong in a daemon memory.
- **Multi-claim body:** the body has two distinct claims joined by "and" or "also". One memory, one claim — split into two fleeting memories (call `createFleetingMemory` again for the second), or trim down to the dominant claim and let the user re-capture the secondary one.

If either is present, before presenting to the user, propose: "This memory mixes claim A with claim B. Promote A and re-capture B? [yes/no]". If yes, trim body to A, propose metadata for A, continue. If no, proceed but flag in the user prompt: "⚠ atomicity: this memory restates content that belongs in `<sibling-memory-path>` — review keywords carefully."

Why this matters: search retrieval is sensitive to keyword density. A memory restating sibling content steals top-rank for queries it shouldn't answer.

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
After promotion, run the **sibling evolution step** (3f) on the newly linked memories.
Print: `Promoted → <permanent memory title>`

**edit**
Ask the user which fields to revise. Show the current proposed values; accept corrections. Re-display the revised block for confirmation, then call `mcp__Engy__promoteMemory` with the revised values.
After promotion, run the **sibling evolution step** (3f) on the newly linked memories.
Print: `Promoted (edited) → <permanent memory title>`

**supersede**
1. Call `mcp__Engy__promoteMemory` with proposed metadata → get back `permanentMemoryId`.
2. For each flagged existing permanent memory that this supersedes, call:
   `mcp__Engy__updatePermanentMemory({ id: <existing id>, supersededById: <new permanentMemoryId> })`
After promotion, run the **sibling evolution step** (3f) on the newly linked memories.
Print: `Promoted → <title>. Marked <existing title> as superseded.`

**contradict**
Do not promote and do not call any memory mutation. Print:
`Flagged as contradiction with <existing title>. Left unpromoted. Review manually.`
The fleeting remains in the DB; the contradiction note exists only in the session output.

**skip**
Do nothing. Print: `Skipped.`

#### 3f: Memory Evolution — Enrich Linked Siblings (runs after every successful promotion)

After `promoteMemory` returns, read `linkedMemories` directly from the MCP response — the server awaits the auto-linker before returning, so the array is fully populated. Do **not** re-query the memory; use the value you already have.

If `linkedMemories` is empty in the response, autoLink either failed silently or found no siblings above the similarity threshold. Skip this step entirely — there is nothing to enrich.

**Purpose (A-MEM rationale):** Most memory systems are purely additive — a new node is created and edges are drawn, but existing nodes stay untouched. A-MEM (Agentic Memory, NeurIPS 2025) shows that enriching linked siblings' metadata with what the new memory teaches improves multi-hop recall by 5–15%. Promotion is the right moment for this: the memory now has its final keywords and themes, giving the clearest signal.

**Resolving a sibling path to its `id`** — `updatePermanentMemory` requires a numeric `id`. Resolve it with a filtered list call:
```
mcp__Engy__listMemories({ workspaceId, compact: false })
// then find the entry whose filePath matches the sibling path
```

For each sibling path in the response's `linkedMemories` (up to 5, permanent memories only):

1. Resolve the sibling's numeric `id` as above. If it cannot be resolved, skip this sibling.
2. Read the sibling's current keywords and themes (from the resolved row, or from the similarity-check results in 3b).
3. Apply this reasoning to yourself:

   > "The newly promoted memory says: `<title> — <keywords> — <themes>`. The sibling memory says: `<sibling title> — <sibling keywords> — <sibling themes>`. Does the newly promoted memory reveal a genuine new connection that enriches this sibling's meaning? If yes, propose 0–3 keyword or theme additions that reflect this connection. Be conservative: only add terms you are high-confidence about. Additions only — never remove existing keywords or themes."

4. **If** you identify 1–3 high-confidence additions:
   - Call `mcp__Engy__updatePermanentMemory({ id: <sibling id>, keywords: <full merged list>, themes: <full merged list> })`.
   - Pass the full merged arrays (existing + additions), not just the delta.
   - Log: `Enriched sibling "<sibling title>" — added: <terms>`.
5. **If** no high-confidence addition exists, skip the sibling silently.

**Hard constraints:**
- Maximum **3 additions** per sibling (keywords + themes combined).
- Additions only — never remove existing keywords or themes.
- Skip if the term is already present in the sibling's existing keywords or themes.
- Skip fleeting memories and reference files — only permanent memories with a resolvable `id`.

This step is inline (no subagent), fast, and silent on skips. It runs after every `approve`, `edit`, or `supersede` action and is invisible to the user unless enrichments actually occur.

### Step 4: Summary

After all candidates are processed (or the user stops early), print:

```
Review complete.

  Reviewed:          <N>
  Promoted:          <N>  (including edits and supersessions)
  Superseded:        <N>  existing memories marked as superseded
  Contradictions:    <N>  flagged (left unpromoted)
  Skipped:           <N>
  Siblings enriched: <N>  across all promotions
```

## Key Principles

- **Sequential only** — one candidate at a time; never batch multiple candidates in a single prompt.
- **LLM enrichment is in-context** — propose metadata using your own reasoning; no extra server-side LLM calls.
- **No project-status gate** — this skill works anytime: during project completion or as ongoing maintenance.
- **Contradict = do not promote** — flagging a contradiction leaves the fleeting untouched; the conflict note lives only in session output.
- **Supersede = promote first, then update** — always create the new permanent record before marking the old one superseded.
- **Evolution is additions-only** — step 3f never removes existing keywords or themes; it only adds. Conservative by design: when in doubt, skip.

## Flow Position

**Typical trigger:** after `/engy:complete-project` distillation phase, or standalone maintenance.

**Next step (optional):** `/engy:propose-sysdocs` to surface patterns identified during review into system documentation.
