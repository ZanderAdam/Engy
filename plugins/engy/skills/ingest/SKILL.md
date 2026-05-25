---
name: engy:ingest
description: Ingest external content (URL, file path, raw text, transcript) into the knowledge layer. Snapshots non-durable sources, links durable ones, drafts a fleeting distillation, dispatches research, and proposes candidate edits to existing notes.
---

# Ingest External Content

Takes a URL, file path, raw text, or transcript reference (e.g., a Granola meeting ID) and walks it through the full knowledge-layer ingestion pipeline: classify → write source record → distill → research → propose edits → reindex.

## MCP Tools

- `mcp__Engy__listWorkspaces` — resolve workspaceId when not in context
- `mcp__Engy__getWorkspaceDetails` — resolve workspace paths (`paths.memoryDir`)
- `mcp__Engy__createFleetingMemory` — draft the fleeting distillation
- `mcp__Engy__reindex` — trigger incremental memory reindex after writing

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

**URL fetch validation (applies when the input is a URL):**
- Reject non-HTTP schemes (`file://`, `javascript:`, `gopher://`, etc.) — print an error and stop.
- Cap fetched body at **5 MB**. If the response exceeds this, truncate and note `[truncated — original was N bytes]`.
- Cap the extracted markdown snapshot body at **2 MB**. Truncate with the same marker if needed.
- Cap redirect chains at **5 hops**. If exceeded, report the final URL reached and ask the user whether to proceed.

**Granola transcripts:**
- Fetch via `mcp__claude_ai_Granola__get_meeting_transcript` (or other `mcp__claude_ai_Granola__*` tools as needed).
- If Granola MCP tools are not present, print: "Granola MCP is not configured. Install and configure the Granola MCP server, then retry." and stop.
- Treat the result as a snapshot.

**Very large sources** (e.g., a long meeting transcript): consider dispatching a dedicated Task for the classify + distill step (step 3) to keep the main context light. For typical sources, the main agent handles everything inline.

### Step 2: Write the Source Record

Write the source record to disk **before** dispatching research. This ensures the research subagent reads from the immutable on-disk artifact, not transient text.

Resolve `memoryDir` via `mcp__Engy__getWorkspaceDetails`. If `memoryDir` is not available from context, fall back to `{workspaceDir}/memory/`.

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

Create `memory/sources/{YYYYMMDDHHmm}-{slug}.md` with provenance frontmatter and the full snapshot body:

```markdown
---
url: <source URL, or omit if not a URL>
origin: <human-readable origin — e.g. "Granola meeting 2025-05-07", "email from alice@example.com">
source_type: <article | transcript | slack | email | pdf | podcast | other>
ingester: engy:ingest
title: <human-readable title>
ingested_at: <ISO 8601 timestamp>
---

<snapshot content here>
```

**Slug generation:** lowercase the title, replace spaces and special characters with hyphens, limit to 40 characters.

**Deduplication:** the server's `writeSourceSnapshot` helper dedupes by SHA-256. If the file already exists at the computed path, print "Source already on disk — reusing existing path: `<path>`" and proceed with the existing path.

**Write surface:** use the built-in Write tool with an absolute path under the workspace dir.

### Step 3: Draft a Fleeting Distillation

Call `mcp__Engy__createFleetingMemory` with a four-part distillation as the `content` and pass the source path via the `sources` field:

```
mcp__Engy__createFleetingMemory({
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

**Atomicity rule (load-bearing for retrieval).** A fleeting distillation captures ONE central claim from the source. Resist restating peripheral facts that belong in their own memories. For example: if the source mentions `ENGY_DIR` defaults in passing, do NOT restate that in this distillation's body if the central claim is about something else — point to it in "Connects to" instead. Why this matters: search relevance is driven by content density; a memory that restates sibling claims wins queries it shouldn't and starves the rightful answer's retrieval rank. Eval evidence: a single context-bleeding zettel dominated 2/15 queries in independent validation (May 2026 sprint).

**Tag derivation (auto-attach where unambiguous).** Beyond the literal `'ingest'` tag, derive tags from the source path:

- **Milestone tag:** if the source path matches `**/milestones/m{N}-*.md` (e.g. `m7-knowledge-layer.plan.md`), add `'m{N}'`.
- **Repo tag:** if the source is inside a workspace repo path, add the repo's short name (e.g. `'engy'`).
- **Doc-class tag:** add one of `'spec'`, `'vision'`, `'plan'`, `'context'`, `'claude-md'` based on filename/path.

These are conventions enforced at ingest because tag filtering (`search({filters:{tags:['m7']}})`) is only as good as the consistency of tags applied. Don't invent new tag tokens here — let `engy:review-memories` propose richer per-memory tags during promotion.

Note the returned `distillationId` (memory `id`) for the commit message.

### Step 4: Dispatch the Research Subagent

Invoke the `engy:research` subagent to find related permanent notes and surface contradictions:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<source content summary> — find related permanent notes and contradictions. Context: workspace=<slug><, repo=<repo-name> if source is repo-related>'
})
```

Pass the first ~500 words of the snapshot (or the reference title + description for links) as the source content summary. Include `filters.repo` in the prompt when the source is clearly scoped to one repo.

Hold the returned `## Findings` digest for step 5.

### Step 5: Propose Candidate Edits

If the research digest identifies existing permanent notes that should be updated in light of the new source:

1. Read the affected file(s) fully before editing.
2. Apply the minimum change needed — add a new section, update a claim, or add a cross-reference (`linkedMemories`, `sources`, or `scenarioIds` frontmatter).
3. Write the change using the Edit tool. Do **not** commit.

Changes land as uncommitted working-tree diffs. The user reviews them in the diff viewer's "Latest Changes" mode and accepts (commits) or reverts per the standard batched review flow. No special approval UI is required.

If no existing notes warrant changes, print "No candidate edits — no existing notes need updating." and continue.

### Step 6: Commit

After all writes for the ingest are done (source record, distillation, and candidate edits), run `git add` + `git commit` from the workspace dir using the Bash tool. One commit per ingest run, not per file. Use the structured `memory(ingest):` format from FR-TG1.8:

```
memory(ingest): <slug>

source_path: memory/sources/<filename>.md
distillation_id: <fleeting memory id>
candidate_edits: <list of edited note paths, or "none">
contradictions: <list of contradicted note paths, or "none">
```

Use `git log --grep='^memory(ingest):'` to audit the operations log.

### Step 7: Trigger Reindex

Call the `reindex` MCP tool to update the memory search index:

```
mcp__Engy__reindex({
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
  Candidate edits: memory/decisions/my-decision.md              (1 file)
  Reindex:         3 indexed, 0 unchanged, 2 needsEmbedding

Next: run /engy:review-memories to promote the distillation when ready.
```

## Key Principles

- **Write source record first** — research reads from disk, not from prompt context. Never dispatch research before the source file exists on disk.
- **No auto-promotion** — the fleeting distillation joins the standard `/engy:review-memories` lifecycle. Ingestion never promotes memories automatically.
- **Main agent by default** — classify, write, and distill in the main agent context. Dispatch a Task subagent only for very large sources (long transcripts).
- **Candidate edits are uncommitted** — user reviews via diff viewer before any permanent note is changed.
- **Fetch safety** — enforce the 5 MB / 2 MB / 5-hop limits even if the user overrides; truncate rather than fail silently.
- **No sibling evolution at ingest** — autoLink only fires on permanent memory creation/promotion, not on fleeting creation. Sibling enrichment happens exclusively in `/engy:review-memories` step 3f, where promotion provides the final keywords and themes.

## Flow Position

**Typical trigger:** user pastes a URL, drops a transcript reference, or wants to capture a document into the workspace memory.

**Next step:** `/engy:review-memories` — promotes the drafted distillation when the user is ready.
