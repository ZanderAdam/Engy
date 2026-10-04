---
description: BlockNote-based rich document editor with inline comments, mermaid diagrams, and markdown persistence.
order: 11
---

# Document Editor

The document editor is the primary authoring surface for workspace and project documentation in Engy. It wraps [BlockNote](https://www.blocknotejs.org/) (a ProseMirror-backed rich-text editor) with a custom schema that adds a native `mermaid` block type, connects to a tRPC-backed comment/thread persistence layer, and serialises to normalised markdown on autosave.

## Key components

| File | Role |
|---|---|
| `web/src/components/editor/document-editor.tsx` | `DocumentEditor` React component — BlockNote host, autosave loop, comment reconciliation, flush/scroll imperative handle |
| `web/src/components/editor/frontmatter.ts` | `stripFrontmatter` — splits `---`-fenced YAML header from markdown body |
| `web/src/components/editor/remark-normalize.ts` | `normalizeMarkdown` — remark pipeline that makes BlockNote's lossy output idempotent |
| `web/src/components/editor/thread-store.ts` | `EngyThreadStore` (DB-backed) and `InMemoryThreadStore` (session-scoped); both implement `CommentStore` |
| `web/src/server/trpc/routers/comment.ts` | `commentRouter` — tRPC procedures for threads and comments (`commentThreads`, `threadComments` tables) |
| `web/src/lib/doc-feedback.ts` | `formatCommentsForExport` — renders doc threads as agent feedback |
| `web/src/server/services/comment-feedback.ts` | `buildPendingFeedback` / `markCommentsSent` — selects and formats the comments not yet sent |
| `web/src/server/live-comment-targets.ts` | `getLiveTarget`, `clearLiveTarget`, `clearLiveTargetsForSession` — the live pin registry in `AppState` |
| `web/src/server/comment-delivery.ts` | `sendPendingComments`, `setLiveTarget`, `onUserComment`, `flushLiveComments` — pastes feedback into a terminal and runs live mode |
| `web/src/hooks/use-comment-delivery.ts` | `useCommentDelivery` — browser side of send and live mode for one comment scope |
| `web/src/components/editor/comments/matcher.ts` | `findTextQuoteMatch` — resolves a `TextQuoteSelector` anchor to a ProseMirror `{ from, to }` range |
| `web/src/components/editor/comments/snapshot.ts` | `snapshotAnchors` — captures text-quote selectors for open threads before each save |
| `web/src/components/editor/comments/reconcile.ts` | `reconcileAnchors` — re-resolves stored anchors after a document reload |
| `web/src/components/editor/mermaid/markdown-bridge.ts` | `codeBlockToMermaid` / `mermaidToCodeBlock` — translates between BlockNote's generic `codeBlock` (for markdown round-trip) and the custom `mermaid` block |
| `web/src/components/editor/mermaid/visual/parse.ts` | `parseFlowchart` / `detectDiagramType` — pragmatic line-based mermaid flowchart parser |
| `web/src/components/editor/mermaid/visual/serialize.ts` | `serializeFlowchart` — emits valid mermaid from a `FlowModel` |
| `web/src/components/editor/mermaid/visual/model-ops.ts` | Pure `FlowModel` mutation helpers — `addNode`, `addConnectedNode`, `deleteNode`, `addEdge`, `deleteEdge`, `updateNodeLabel`, `updateNodeShape`, `updateEdgeLabel`, `duplicateNode` |

## Autosave and markdown normalisation

`DocumentEditor` runs a 1500 ms debounced autosave (`AUTOSAVE_DELAY_MS = 1500`). On each cycle it: (1) snapshots open comment anchors, (2) converts any custom `mermaid` blocks back to `codeBlock` nodes via `mermaidToCodeBlock`, (3) calls `editor.blocksToMarkdownLossy`, (4) pipes the result through `normalizeMarkdown` (which re-serialises via remark with fixed bullet/HR/fence/list settings to eliminate BlockNote's non-idempotent formatting), and (5) prepends the stored frontmatter header before calling `onSave`. A content hash guards against saving unchanged content. An imperative `flush()` handle lets callers bypass the debounce and force an immediate serialisation.

Frontmatter is handled by `stripFrontmatter` at load time: the `---`-fenced YAML header is split off, the body alone is parsed into BlockNote blocks, and the header is stored in a ref so it can be re-prepended on every save without being processed by the rich-text engine.

## Comment threads

`commentRouter` exposes a full thread-and-comment CRUD surface over two tables: `commentThreads` (one row per thread, keyed by `workspaceId` + `documentPath`) and `threadComments` (one row per comment, keyed by `threadId`). The `workspaceId` is resolved from a `workspaceSlug` at mutation time; when no slug is provided the thread is workspace-less (open-directory mode) with `workspaceId: null`.

`EngyThreadStore` bridges BlockNote's `ThreadStore` protocol to this tRPC layer. Every mutation applies an optimistic local update before firing the server call; if the call rejects, the update is rolled back and a `toast.error` surfaces a human message. The `ready` promise resolves after the initial `listThreads` query completes, which lets `reconcileAnchors` wait for threads before re-anchoring.

`listThreads` enforces workspace isolation: a slug-scoped query matches on `workspaceId`; a slug-less query uses `isNull(workspaceId)`. The two predicates are mutually exclusive, so workspace threads and open-dir threads never appear in each other's result sets.

`listThreadsByPrefix` uses a SQL `LIKE` prefix match on `documentPath` and runs the same workspace-isolation condition, enabling comment summaries that span multiple documents under a directory prefix.

## Sending comments to an agent

Each `threadComments` row has a `sentAt` timestamp. A send takes the unresolved threads in a scope (one document, or every thread under a path prefix for a diff branch) and picks the comments that are not deleted and not yet sent. Agent replies are never picked, because the agent wrote them; an agent-authored thread root (a review finding) is picked, so findings can still go to the agent that fixes them. When a thread already had comments sent, its first comment is repeated as context above the new ones. Every comment carries an author label (`user`, `agent`, or a GitHub login).

`comment.sendPending` formats that delta on the server, pastes it into the terminal session the browser names (the focused terminal, found through a `resolveOnly` `terminal:inject` event), and sets `sentAt` on what it sent. Delivery uses the same bracketed paste and per-agent Enter as cross-terminal dispatch. Runner sessions take the text from `comment.pendingFeedback` and confirm it with `comment.markSent` after `execution.sendFeedback` succeeds.

Live mode pins a terminal session to a scope (`comment.setLive`). The pin lives in `AppState.liveCommentTargets`, so a server restart drops it. When the user creates a thread or a reply in a live scope, the server sends the scope's threads that hold an unsent user comment at once if the terminal is idle with nothing queued; otherwise the comments wait in the database and go out on a later idle transition, after any queued dispatch. One idle transition pastes for one live scope only, because a second paste before the first paste's Enter would merge both into one prompt. Threads with no new user comment, such as agent findings or synced GitHub comments, are left for a manual send, so an agent never gets its own findings back. When the pinned session exits or is killed, the pin is removed and `COMMENT_LIVE_CHANGE` is broadcast with reason `session-ended`.

## Comment anchoring

When comments are enabled, `snapshotAnchors` captures a `TextQuoteSelector` (exact text + surrounding context) for each open thread before each save. After a document reload, `reconcileAnchors` re-resolves these selectors against the new ProseMirror document via `findTextQuoteMatch`.

`findTextQuoteMatch` uses a two-strategy approach: (1) exact substring match across all occurrences, scoring by prefix/suffix context overlap to pick the best candidate; (2) if no exact match, a normalised fallback that collapses whitespace and lowercases before matching. The fallback maps normalised offsets back to original document positions via a character index map. When neither strategy finds a match the function returns `null` and the thread is shown as orphaned in the sidebar.

## Mermaid integration

A custom `mermaid` block spec is registered in the BlockNote schema alongside the default block specs. In the editor, mermaid diagrams render via the mermaid library and can be opened in a visual flowchart editor.

Markdown round-trip is handled by the bridge: on load, `codeBlockToMermaid` converts `codeBlock` nodes with `language: 'mermaid'` into `mermaid` blocks (joining multi-text inline content); on save, `mermaidToCodeBlock` converts them back to standard fenced code blocks before `blocksToMarkdownLossy` runs. Non-mermaid `codeBlock` nodes are left untouched by both directions.

The visual flowchart editor uses a pragmatic line-based parser (`parseFlowchart`) that extracts a `FlowModel` (keyword, direction, typed nodes with shape, typed edges with style/label, subgraphs, and raw unsupported statements). Unknown content lands in `model.raw` so a parse–edit–serialize cycle never silently drops the user's content. `detectDiagramType` checks the first non-comment, non-blank line to distinguish `flowchart`/`graph` diagrams from all other mermaid types. `FlowModel` mutations (`addNode`, `addConnectedNode`, `addEdge`, `deleteNode`, `deleteEdge`, etc.) are pure functions that never mutate their input, making the visual editor's React state predictable without a DOM.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-EDITOR-010 | WHEN `createThread` is called with a valid `workspaceSlug` and `documentPath`, the system SHALL insert a `commentThreads` row and an initial `threadComments` row (with `userId: 'local-user'`) and return the thread with `resolved: false` and `comments` containing the initial comment; IF the workspace slug is unknown, the system SHALL throw `NOT_FOUND`. |
| FR-EDITOR-020 | WHEN `createThread` is called without a `workspaceSlug`, the system SHALL create the thread with `workspaceId: null`, keyed solely by the absolute `documentPath`. |
| FR-EDITOR-030 | WHEN `listThreads` is called with a `workspaceSlug`, the system SHALL return only threads whose `workspaceId` matches that workspace and whose `documentPath` matches exactly; WHEN called without a `workspaceSlug`, the system SHALL return only threads where `workspaceId IS NULL` — the two result sets SHALL never overlap; in both cases threads that have no comments SHALL be excluded from the result. |
| FR-EDITOR-040 | WHEN `listThreadsByPrefix` is called, the system SHALL return all threads (with their comments) whose `documentPath` starts with the given prefix within the same workspace scope, ordered by `createdAt` ascending, excluding threads that have no comments. |
| FR-EDITOR-050 | WHEN `deleteComment` is called, the system SHALL set `body: null` and `deletedAt` to the current timestamp on the comment row, leaving the thread and all remaining comments retrievable via `listThreads`. |
| FR-EDITOR-060 | WHEN `resolveThread` is called, the system SHALL set `resolved: true`, `resolvedBy: 'local-user'`, and `resolvedAt` to the current timestamp; WHEN `unresolveThread` is called, the system SHALL clear those fields back to `false` and `null`. |
| FR-EDITOR-070 | WHEN `addReaction` is called, the system SHALL add the emoji entry (or push `userId` into an existing entry) without duplicating the user; WHEN `deleteReaction` is called, the system SHALL remove the user from `userIds` and drop the entire entry when `userIds` becomes empty. |
| FR-EDITOR-080 | WHEN any `EngyThreadStore` mutation (createThread, addComment, deleteThread, resolveThread, unresolveThread, updateComment, setThreadMetadata) is called, the system SHALL apply the change to local state immediately and, IF the server mutation rejects, SHALL roll back the local state and display a `toast.error` with a human-readable message. |
| FR-EDITOR-090 | WHEN `findTextQuoteMatch` resolves a `TextQuoteSelector` against a ProseMirror document, the system SHALL first attempt an exact substring match scored by prefix/suffix context overlap; IF no exact match exists, the system SHALL attempt a normalised fallback (whitespace-collapsed, case-insensitive) mapping results back to original document positions; IF neither strategy succeeds, the system SHALL return `null`. |
| FR-EDITOR-110 | WHEN the document editor serialises content, the system SHALL pipe `blocksToMarkdownLossy` output through `normalizeMarkdown` (remark with fixed bullet `-`, rule `-`, emphasis `*`, tight lists, and hard-break stripping) so that a second serialize–parse–serialize cycle produces identical output. |
| FR-EDITOR-120 | The system SHALL split a `---`-fenced YAML frontmatter header from the markdown body via `stripFrontmatter`; an unclosed opening delimiter SHALL be treated as no frontmatter (empty header, full content as body); `header + body` SHALL always reconstruct the original string exactly. |
| FR-EDITOR-130 | WHEN loading markdown that contains a fenced code block with `language: 'mermaid'`, the system SHALL convert it to a custom `mermaid` block node via `codeBlockToMermaid`; WHEN serialising, the system SHALL convert `mermaid` block nodes back to `codeBlock` nodes via `mermaidToCodeBlock`; non-mermaid code blocks SHALL pass through both transforms unchanged. |
| FR-EDITOR-140 | WHEN `parseFlowchart` is called with a mermaid flowchart or graph diagram, the system SHALL extract a `FlowModel` containing the keyword, direction, nodes (with shape), edges (with style and label), subgraphs, and unrecognised statements in `raw`; `serializeFlowchart` SHALL emit valid mermaid from that model; a parse–serialize–parse cycle SHALL be structurally stable; IF the diagram type is not `flowchart` or `graph`, `parseFlowchart` SHALL return `null`. |
| FR-EDITOR-150 | The system SHALL provide pure `FlowModel` mutation functions (`addNode`, `addConnectedNode`, `deleteNode`, `addEdge`, `deleteEdge`, `updateNodeLabel`, `updateNodeShape`, `updateEdgeLabel`, `duplicateNode`) that each return a new model without mutating the input. |
| FR-EDITOR-160 | WHEN a comment is written to a thread through the shared comment service, the system SHALL reject an unknown `threadId` with `NOT_FOUND`; the reply SHALL be attributed to the caller-supplied `userId` (defaulting to `local-user`, and `agent` for agent replies); and a text-only reply SHALL be serialised to the body shape the owning thread uses — a plain string for a diff thread (`metadata.type: 'diff'` or a `diff://` `documentPath`), otherwise a BlockNote block array parsed from the text as markdown (paragraphs, headings, bullet, numbered and check lists, code blocks, quotes, bold, italic, strike, inline code and links). IF `resolve` is requested, the thread SHALL additionally be marked resolved crediting the same `userId`. |
| FR-EDITOR-170 | WHEN document comments are exported for an agent, the system SHALL name each thread's id alongside its quoted anchor, SHALL keep link text and nested list items in each comment's text, and SHALL state how to reply to a thread. |
| FR-EDITOR-180 | WHEN the user right-clicks a Code or Diffs editor tab, the system SHALL offer Close, Close others, Close tabs to the right, and Close all tabs. Close others SHALL keep only that tab and make it active; Close tabs to the right SHALL drop every later tab and move focus to that tab only if the active tab was closed; both SHALL prune closed files from back/forward history, and SHALL leave state unchanged when nothing would close. |
| FR-EDITOR-190 | WHEN the user right-clicks a document tab, the system SHALL offer Close, Close others, Close tabs to the right, and Close all tabs, each scoped to that tab's dock group; IF the active document is closed by Close others or Close tabs to the right, THEN the system SHALL activate the clicked tab. |
| FR-EDITOR-200 | WHEN comments in a scope are sent to an agent, the system SHALL include only comments of unresolved threads that are not deleted, not sent before, and not agent replies (an agent-authored thread root is included), SHALL record each included comment as sent, and SHALL broadcast `COMMENT_CHANGE` for each thread it marked. |
| FR-EDITOR-210 | WHEN a sent thread gets a new comment and that comment is sent, the system SHALL show the thread's first comment as context, set apart from the new comments, and SHALL label every comment with its author. |
| FR-EDITOR-220 | IF a send finds no unsent comments in its scope, THEN the system SHALL paste nothing and SHALL report zero comments sent. |
| FR-EDITOR-230 | WHEN comments are sent to a terminal session, the system SHALL paste them as one bracketed paste followed by the agent's submit keys; IF the session is not running, THEN it SHALL reject the send with `NOT_FOUND`; IF no daemon is connected, THEN it SHALL reject the send with `PRECONDITION_FAILED` and leave the comments unsent. |
| FR-EDITOR-240 | WHILE a comment scope is live, WHEN the user creates a thread or a reply in that scope, the system SHALL send the unsent comments of every thread in the scope that has an unsent user comment to the pinned terminal at once if it is idle with nothing queued, and otherwise SHALL send them on a later idle transition after any queued dispatch, pasting for at most one live scope per idle transition. Threads with no unsent user comment (agent findings, synced GitHub comments) SHALL wait for a manual send. |
| FR-EDITOR-250 | WHEN the terminal session pinned to a live scope exits or is killed, the system SHALL turn live mode off for that scope and SHALL broadcast `COMMENT_LIVE_CHANGE` with reason `session-ended`. |
| FR-EDITOR-260 | WHEN live mode is turned on for a scope, the system SHALL refuse a session that is not running, SHALL broadcast the pinned session, and SHALL send the scope's waiting user comments under the FR-EDITOR-240 rules; WHEN live mode is turned off, the system SHALL stop sending. |

## Sources

No prior knowledge found.
