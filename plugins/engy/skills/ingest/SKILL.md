---
name: ingest
description: This skill should be used when the user asks to "ingest", "capture this URL", "add this article to memory", "save this transcript", "ingest this document", or "add this to the knowledge layer". Snapshots non-durable sources, links durable ones, drafts a fleeting distillation, dispatches research, and proposes candidate edits to existing notes.
---

# Ingest External Content

Takes a URL, file path, raw text, or transcript reference (e.g., a Granola meeting ID) and walks it through the full knowledge-layer ingestion pipeline: classify → review → write source record → distill → research → propose edits → reindex.

## MCP Tools

- `listWorkspaces` — resolve workspaceId when not in context
- `getWorkspaceDetails` — resolve workspace paths (`paths.memoryDir`)
- `writeSourceSnapshot` — write a snapshot file, deduping by SHA-256; returns `{ filePath: string; reused: boolean }`
- `createFleetingMemory` — draft the fleeting distillation
- `reindex` — trigger incremental memory reindex after writing

## Process

### Step 1: Classify Durability

Determine whether the source is **durable** (link) or **non-durable** (snapshot):

**Link (durable)** — stable content that is unlikely to change or disappear:
- Internal docs and stable repo paths (include a commit SHA if possible)
- Versioned public RFCs and official specs (IETF, W3C, ISO)
- Versioned release notes or changelogs at a pinned tag

**Snapshot (non-durable)** — transient or link-rot-prone content:
- Slack threads, Discord messages, internal chat
- Meeting transcripts (including Granola)
- Blog posts, articles, Medium posts, Substack
- PDFs from arbitrary URLs, emails, podcasts, whiteboard photos

**URL fetch validation (hard rules):**
- Reject non-HTTP/HTTPS schemes (`file://`, `javascript:`, `gopher://`, etc.) — print an error and stop.
- Abort with an error message if `Content-Length` header exceeds 5 MB, or if the fetched body exceeds 5 MB.
- Truncate the snapshot body at ~2 MB of markdown with a literal `[truncated — original was N bytes]` marker at the cut point.
- Treat more than 5 redirects as suspicious — print a warning and ask the user before continuing.

**Granola transcripts:**
- Fetch via `mcp__claude_ai_Granola__get_meeting_transcript` (or other `mcp__claude_ai_Granola__*` tools as needed).
- If Granola MCP tools are not present, print: "Granola MCP is not configured. Install and configure the Granola MCP server, then retry." and stop.
- Treat the result as a snapshot.

### Step 2: PII / Safety Review, then Write the Source Record

**Before writing a snapshot to disk**, review the fetched content for sensitive or personally-identifiable information. For meeting transcripts (Granola and similar), emails, or any content that may contain names, contact details, or confidential discussion:

```
The snapshot body will be permanently committed to git history.
If it contains sensitive or personally-identifiable information you want to redact, do so now (edit the content before proceeding), or type "skip" to abort entirely.
Proceed? [yes / skip]
```

Redact or abort based on the response. **Do not call `writeSourceSnapshot` until the content has been reviewed.** The tool commits server-side; there is no post-write redaction path.

Write the source record to disk **before** dispatching research. This ensures the research subagent reads from the immutable on-disk artifact, not transient text.

Resolve `memoryDir` via `getWorkspaceDetails`. If `memoryDir` is not available from context, fall back to `{workspaceDir}/memory/`.

#### Link (durable source)

Create `memory/references/{slug}.md` with frontmatter only — no content body:

```markdown
---
url: <canonical URL>
type: <rfc | spec | repo | docs | release-notes>
title: <human-readable title>
description: <one-sentence summary>
---
```

#### Snapshot (non-durable source)

Call `writeSourceSnapshot` with the workspaceId, content, and provenance fields (flat params):

```
writeSourceSnapshot({
  workspaceId: <id>,
  title: <human-readable title>,
  content: <snapshot content>,
  sourceType: <article | transcript | slack | email | pdf | podcast | other>,
  url: <source URL, omit if not a URL>,
  origin: <human-readable origin — e.g. "Granola meeting 2025-05-07", "email from alice@example.com">,
  ingestedAt: <ISO 8601 timestamp, optional — defaults to now>
})
```

The tool writes `memory/sources/{YYYYMMDDHHmm}-{slug}.md` (the `ingester` field is set server-side), dedupes by SHA-256, **and commits the file server-side** with a structured `memory(ingest):` message. It returns `{ filePath, reused }`. If `reused` is `true`, print "Source already on disk — reusing existing path: `<filePath>`" and proceed with the returned path.

**Slug generation:** lowercase the title, replace spaces and special characters with hyphens, limit to 40 characters.

### Step 3: Draft a Fleeting Distillation

Call `createFleetingMemory` with a four-part distillation as the `content` and pass the source path via the `sources` field:

```
createFleetingMemory({
  workspaceId: <id>,
  type: 'capture',
  source: 'agent',
  tags: ['ingest', ...<derived tags, see below>],
  sources: ['<source-path>'],
  content: `**Core claim:** <the single most important assertion or finding>

**What surprised:** <what was unexpected or non-obvious>

**Connects to:** <related topics, decisions, or existing notes this links to>

**Contradicts:** <any prior positions or notes this conflicts with, or "nothing identified">
`
})
```

**Atomicity rule (load-bearing for retrieval).** A fleeting distillation captures ONE central claim from the source. Resist restating peripheral facts that belong in their own memories. For example: if the source mentions `ENGY_DIR` defaults in passing, do NOT restate that in this distillation's body if the central claim is about something else — point to it in "Connects to" instead. Why this matters: search relevance is driven by content density; a memory that restates sibling claims wins queries it shouldn't and starves the rightful answer's retrieval rank.

**Tag derivation (auto-attach where unambiguous).** Beyond the literal `'ingest'` tag, derive tags from the source path:

- **Milestone tag:** if the source path matches `**/milestones/m{N}-*.md` (e.g. `m7-knowledge-layer.plan.md`), add `'m{N}'`.
- **Repo tag:** if the source is inside a workspace repo path, add the repo's short name (e.g. `'engy'`).
- **Doc-class tag:** add one of `'spec'`, `'vision'`, `'plan'`, `'context'`, `'claude-md'` based on filename/path.

These are conventions enforced at ingest because tag filtering (`search({filters:{tags:['m7']}})`) is only as good as the consistency of tags applied. Don't invent new tag tokens here — let `engy:review-memories` propose richer per-memory tags during promotion.

Note the returned `distillationId` (memory `id`) for the ingest summary.

### Step 4: Dispatch the Research Subagent

Invoke the `engy:research` subagent to find related permanent notes and surface contradictions:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<source content summary> — find related permanent notes and contradictions. Context: workspaceId=<id>, workspace=<slug><, repo=<repo-name> if source is repo-related>'
})
```

`workspaceId` (the numeric id from `getWorkspaceDetails`) is required — `engy:research` hard-errors without it.

Pass the first ~500 words of the snapshot (or the reference title + description for links) as the source content summary. Include `filters.repo` in the prompt when the source is clearly scoped to one repo.

Hold the returned `## Findings` digest for step 5.

**Partial-failure recovery:** if research fails at this point, do not silently proceed. Print: "Research subagent failed. Recoverable state: source file written to `<filePath>` (committed by server), fleeting distillation created with id `<distillationId>` (in DB). Re-run `/engy:ingest` with the same source to retry, or continue manually from Step 5." Then stop.

### Step 5: Propose Candidate Edits

If the research digest identifies existing permanent notes that should be updated in light of the new source:

1. Read the affected file(s) fully before editing.
2. Apply the minimum change needed — add a new section, update a claim, or add a cross-reference (`linkedMemories`, `sources`, or `scenarioIds` frontmatter).
3. Write the change using the Edit tool. Leave these as **uncommitted working-tree changes** — the user reviews them via the diff viewer's "Latest Changes" mode. Do NOT stage or commit candidate edits.

If no existing notes warrant changes, print "No candidate edits — no existing notes need updating." and continue.

### Step 6: Ingest Commit Summary

The `writeSourceSnapshot` tool already committed the source record server-side (with a structured `memory(ingest):` message per FR-TG1.8). There is **no additional git commit to run** for the source file. Candidate edits from Step 5 remain as uncommitted working-tree changes intentionally — they are for the user to review and commit separately.

Print a note referencing the git log for the operations record:

```
Source committed by server — inspect with:
  git -C <workspaceDir> log --grep='^memory(ingest):' --pretty=oneline
```

The server-side commit has this shape (written by `writeSourceSnapshot` before Step 3 runs):

```
memory(ingest): <sanitized title>

source_path: memory/sources/<filename>.md
source_type: <article | transcript | slack | email | pdf | podcast | other>
```

The distillation id, candidate-edit count, and contradiction count are **not** in the commit — they are only available after Steps 3–5 complete. Report them in the ingest summary (Step 7 output) instead.

### Step 7: Trigger Reindex

Call the `reindex` MCP tool to update the memory search index:

```
reindex({
  workspaceId: <id>,
  collection: 'memory',
  full: false
})
```

Print the structured counts returned by the tool, for example:

```
Reindex complete.
  Indexed:          3
  Unchanged:        0
  Needs embedding:  2  (embedding runs in background)
```

If `needsEmbedding > 0`, note: "Embedding will complete in the background — search relevance improves as it finishes."

## Output Format

After all steps complete, print a summary:

```
Ingest complete.

  Source:          memory/sources/20250507-1430-my-article.md   (snapshot)
  Distillation:    fleeting memory #<id>
  Candidate edits: memory/decisions/my-decision.md              (1 file, uncommitted — review in diff viewer)
  Reindex:         3 indexed, 0 unchanged, 2 needsEmbedding

Next: run /engy:review-memories to promote the distillation when ready.
```

## Key Principles

- **PII check before write** — review the fetched content for sensitive information before calling `writeSourceSnapshot`. The server commits server-side immediately; there is no post-write redaction path.
- **Server owns the source commit** — `writeSourceSnapshot` commits the source record automatically. Do not run an additional `git commit` for the source file.
- **Candidate edits stay uncommitted** — proposed edits to existing permanent notes are uncommitted working-tree changes for the user to review in the diff viewer. Do not stage or commit them.
- **Write source record first** — research reads from disk, not from prompt context. Never dispatch research before the source file exists on disk.
- **No auto-promotion** — the fleeting distillation joins the standard `/engy:review-memories` lifecycle. Ingestion never promotes memories automatically.
- **Main agent by default** — classify, write, and distill in the main agent context. Dispatch a Task subagent only for very large sources (long transcripts).
- **No sibling evolution at ingest** — autoLink only fires on permanent memory creation/promotion, not on fleeting creation. Sibling enrichment happens exclusively in `/engy:review-memories` step 3f, where promotion provides the final keywords and themes.

## Flow Position

**Typical trigger:** user pastes a URL, drops a transcript reference, or wants to capture a document into the workspace memory.

**Next step:** `/engy:review-memories` — promotes the drafted distillation when the user is ready.
