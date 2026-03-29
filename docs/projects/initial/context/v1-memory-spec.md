# Engy Memory System Requirements

## 1. Introduction

### 1.1 Purpose

This document defines the requirements for the Engy Memory System, a Zettelkasten-inspired knowledge management capability that enables AI agents to store, retrieve, and evolve memories across tasks and projects. The system provides persistent, human-readable memory storage with full version control, enabling both AI agents and human users to build and maintain project knowledge over time.

### 1.2 Background and Inspiration

The memory system draws from several established approaches:

**A-MEM (Agentic Memory for LLM Agents)**: A research system from Rutgers University that applies Zettelkasten principles to AI memory. A-MEM demonstrates that interconnected knowledge networks with dynamic indexing and linking significantly outperform static memory approaches, particularly for multi-hop reasoning tasks requiring connections across multiple memories. Key concepts adopted include:
- Atomic note construction with LLM-generated keywords, tags, and contextual descriptions
- Flexible link generation based on semantic similarity and meaningful relationships
- Memory evolution where existing memories update based on new information

**ACE (Agentic Context Engineering)**: A framework from Stanford/SambaNova that treats contexts as evolving playbooks through a modular process of generation, reflection, and curation. Key concepts adopted include:
- Three-role architecture: Generator, Reflector, and Curator
- Delta updates that preserve detailed knowledge rather than rewriting
- Grow-and-refine mechanism for managing expansion and redundancy

**Zettelkasten Method**: A knowledge management system emphasizing atomic notes, flexible linking, and emergent structure through connections rather than hierarchies.

**Hybrid Graph-Vector RAG**: Research demonstrates that combining graph-based retrieval with vector similarity search significantly outperforms either approach alone, particularly for relationship-heavy queries and multi-hop reasoning.

### 1.3 Scope

This document covers requirements for:
- Memory storage and file format
- Memory creation and updates
- Memory retrieval and search
- Memory evolution and linking
- Cleanup and curation
- Conflict detection and resolution
- Git version control integration
- Human interface for memory management
- MCP tool interface for AI agents

### 1.4 Definitions

| Term | Definition |
|------|------------|
| Memory | A discrete unit of knowledge stored as a markdown file with structured frontmatter |
| Project Memory | A memory scoped to an entire project, accessible across all tasks |
| Task Memory | A memory scoped to a specific task, representing working knowledge during task execution |
| Memory Evolution | The process of updating existing memories based on new information |
| Link Generation | The process of establishing meaningful relationships between memories |
| Memory Index | A searchable database derived from memory files, serving as an acceleration layer |
| Cleanup Agent | A specialized AI process that curates, consolidates, and organizes memories |
| Supersession | When a newer memory replaces an older memory containing outdated information |

---

## 2. Memory Storage Requirements

### 2.1 File-Based Storage

**REQ-STORE-001**: The system shall store each memory as an individual markdown file with YAML frontmatter.

**REQ-STORE-002**: The system shall use timestamp-based file naming in the format `YYYYMMDDHHmm-descriptive-slug.md` to ensure chronological ordering and uniqueness.

**REQ-STORE-003**: The system shall store project-level memories in `<engy-data>/<project-slug>/memories/`.

**REQ-STORE-004**: The system shall store task-level memories in `<engy-data>/<project-slug>/tasks/<task-slug>/memories/`.

**REQ-STORE-005**: The memory files shall be the authoritative source of truth; any database or index shall be derived from these files.

**REQ-STORE-006**: The system shall support manual editing of memory files by users outside of the Engy application.

**REQ-STORE-007**: When manual file edits are detected, the system shall re-index the modified memories to maintain consistency.

### 2.2 Memory File Format

**REQ-FORMAT-001**: Each memory file shall contain YAML frontmatter with the following required fields:
- `id`: Unique identifier matching the filename timestamp
- `type`: Classification of the memory (e.g., decision, learning, preference, fact, blocker, approach, discovery)
- `scope`: Either "project" or "task:<task-slug>"
- `keywords`: Array of low-level retrieval terms
- `themes`: Array of high-level conceptual terms
- `source`: Origin of the memory (agent, user, or system)
- `confidence`: Numeric value 0-1 indicating certainty for AI-generated memories
- `created`: ISO 8601 timestamp
- `updated`: ISO 8601 timestamp

**REQ-FORMAT-002**: Each memory file shall contain optional frontmatter fields:
- `supersedes`: ID of memory this one replaces
- `superseded_by`: ID of memory that replaced this one
- `links`: Array of relationship objects with type and target ID

**REQ-FORMAT-003**: The memory content following frontmatter shall be valid markdown supporting headers, lists, code blocks, and links.

**REQ-FORMAT-004**: The system shall support link relationship types including: `relates_to`, `led_to`, `supersedes`, `contradicts`, `derived_from`, and `applies_to`.

---

## 3. Git Version Control Requirements

### 3.1 Repository Management

**REQ-GIT-001**: The system shall maintain a git repository for each project's memory storage.

**REQ-GIT-002**: When a memory is created, the system shall stage and commit the new file.

**REQ-GIT-003**: When a memory is updated, the system shall commit the changes with a descriptive message.

**REQ-GIT-004**: When a memory is deleted, the system shall remove the file via git and commit the deletion.

### 3.2 Commit Messages

**REQ-GIT-005**: The system shall generate descriptive commit messages using AI that explain the nature and purpose of memory changes.

**REQ-GIT-006**: Single memory operation commits shall include:
- Operation type (create, update, delete)
- Memory title or summary
- Source (agent, user, system)
- Relevant keywords or context

**REQ-GIT-007**: Batch operation commits shall include:
- Summary of all changes
- Count of memories affected
- Reason for batch operation

### 3.3 History and Reversion

**REQ-GIT-008**: Users shall be able to view the complete history of any memory file through git history.

**REQ-GIT-009**: Users shall be able to revert any memory to a previous state using git reversion capabilities.

**REQ-GIT-010**: When the cleanup agent performs batch operations, it shall work on a separate branch to allow human review before merging.

**REQ-GIT-011**: Users shall be able to review diffs of cleanup agent changes before accepting them.

---

## 4. Memory Creation Requirements

### 4.1 AI-Initiated Creation

**REQ-CREATE-001**: AI agents shall be able to create memories during task execution via MCP tool calls.

**REQ-CREATE-002**: When an AI agent creates a memory, the system shall use an LLM to extract:
- Keywords capturing key concepts (for low-level retrieval)
- Themes capturing broader topics (for high-level retrieval)
- A contextual description explaining why this information matters

**REQ-CREATE-003**: AI-created memories shall include a confidence score indicating the agent's certainty about the information.

**REQ-CREATE-004**: The AI agent shall decide when to create memories based on its assessment of information value, including:
- Discoveries made during implementation
- Decisions and their rationale
- Dead ends attempted and why they failed
- External references consulted
- Questions requiring clarification

**REQ-CREATE-005**: When a task is marked complete, the system shall automatically generate a task summary memory containing:
- Outcome achieved
- Approach taken
- Blockers encountered
- Key learnings
- Links to any memories created during task execution

**REQ-CREATE-006**: The task completion memory shall be stored at the task level and linked to relevant project-level memories.

### 4.3 User-Initiated Creation

**REQ-CREATE-007**: Users shall be able to create memories directly through the Engy interface.

**REQ-CREATE-008**: Users shall be able to create memories by manually adding markdown files to the appropriate directory.

**REQ-CREATE-009**: User-created memories shall have `source: user` and `confidence: 1.0`.

---

## 5. Memory Retrieval Requirements

### 5.1 Hybrid Retrieval Strategy

**REQ-RETRIEVE-001**: The system shall support hybrid retrieval combining vector similarity search with graph-based relationship traversal.

**REQ-RETRIEVE-002**: The system shall support three retrieval modes:
- **Local**: Detail-oriented queries targeting specific entities and precise information
- **Global**: Abstract queries aggregating information across related entities and themes
- **Hybrid**: Combined approach using both local and global retrieval

**REQ-RETRIEVE-003**: For local retrieval, the system shall use keyword matching and vector similarity on the `keywords` field.

**REQ-RETRIEVE-004**: For global retrieval, the system shall use theme matching and vector similarity on the `themes` field with relationship aggregation.

**REQ-RETRIEVE-005**: For hybrid retrieval, the system shall merge and rank results from both local and global approaches.

### 5.2 Automatic Context Injection

**REQ-RETRIEVE-006**: When task details are requested, the system shall automatically retrieve and return the top-N most relevant project memories.

**REQ-RETRIEVE-007**: The number of automatically injected memories shall be configurable with a reasonable default.

**REQ-RETRIEVE-008**: Automatically retrieved memories shall be returned as metadata (ID, title, relevance score) to support lazy loading.

### 5.3 Research Subagent

**REQ-RETRIEVE-009**: The system shall provide a research capability for deep memory exploration beyond automatic retrieval.

**REQ-RETRIEVE-010**: The research capability shall support multi-hop queries that traverse memory relationships.

**REQ-RETRIEVE-011**: The research capability shall support cross-project searches when relevant.

**REQ-RETRIEVE-012**: The research capability shall be able to summarize multiple memories into coherent context.

### 5.4 Background Enrichment

**REQ-RETRIEVE-013**: When a task is created or updated, the system shall queue a background job to search project memories for relevant context.

**REQ-RETRIEVE-014**: The background enrichment process shall attach high-confidence matches to the task as suggested memories.

**REQ-RETRIEVE-015**: Suggested memories shall require confidence above a configurable threshold before attachment.

**REQ-RETRIEVE-016**: The system shall limit the number of suggested memories per task to a configurable maximum.

---

## 6. Memory Evolution Requirements

### 6.1 Evolution Triggers

**REQ-EVOLVE-001**: When a new memory is created, the system shall evaluate whether related existing memories should be updated.

**REQ-EVOLVE-002**: Memory evolution shall be able to update:
- Contextual descriptions to incorporate new understanding
- Keywords and themes to improve retrieval
- Links to establish new relationships

**REQ-EVOLVE-003**: The original content of a memory shall not be modified by evolution; only metadata and descriptions may change.

### 6.2 Configurable Batching

**REQ-EVOLVE-004**: The system shall support configurable evolution modes:
- **Immediate**: Process evolution on each memory insert
- **Batch**: Process evolution after N inserts or at time intervals
- **Off**: Disable automatic evolution

**REQ-EVOLVE-005**: The default evolution mode shall be immediate with a limit on maximum evolutions per insert.

**REQ-EVOLVE-006**: The batch size and interval shall be configurable.

**REQ-EVOLVE-007**: When batching, the system shall consolidate multiple evolution operations into efficient LLM calls.

---

## 7. Link Generation Requirements

### 7.1 Automatic Linking

**REQ-LINK-001**: When a new memory is created, the system shall identify candidate related memories based on embedding similarity.

**REQ-LINK-002**: The system shall use an LLM to evaluate candidate links and determine which represent meaningful relationships.

**REQ-LINK-003**: Meaningful links shall be established bidirectionally in both memory files.

**REQ-LINK-004**: Each link shall include a relationship type describing the nature of the connection.

### 7.2 Link Types

**REQ-LINK-005**: The system shall support the following link relationship types:
- `relates_to`: General topical relationship
- `led_to`: Causal relationship where one memory influenced another
- `supersedes`: Newer memory replaces outdated information
- `contradicts`: Memories contain conflicting information
- `derived_from`: Memory was created based on another
- `applies_to`: Memory is relevant to a specific context

**REQ-LINK-006**: Users shall be able to manually create, modify, and remove links between memories.

---

## 8. Cleanup and Curation Requirements

### 8.1 Cleanup Agent Architecture

**REQ-CLEANUP-001**: The system shall provide a cleanup agent that periodically curates the memory collection.

**REQ-CLEANUP-002**: The cleanup agent shall follow an ACE-inspired architecture with three phases:
- **Reflect**: Analyze current memory state for issues and patterns
- **Curate**: Generate delta updates to address identified issues
- **Apply**: Execute updates with appropriate git commits

**REQ-CLEANUP-003**: The cleanup agent shall work on a separate git branch to allow human review before changes are merged.

### 8.2 Cleanup Operations

**REQ-CLEANUP-004**: The cleanup agent shall identify and merge semantically duplicate memories.

**REQ-CLEANUP-005**: The cleanup agent shall identify memories with no links and low access that may be candidates for pruning.

**REQ-CLEANUP-006**: The cleanup agent shall identify clusters of related memories and create consolidation summaries.

**REQ-CLEANUP-007**: The cleanup agent shall suggest or apply consistent tagging and categorization.

**REQ-CLEANUP-008**: The cleanup agent shall use delta updates rather than full rewrites to preserve detailed knowledge.

### 8.3 Cleanup Scheduling

**REQ-CLEANUP-009**: Cleanup operations shall run on a configurable schedule (e.g., daily, weekly).

**REQ-CLEANUP-010**: Users shall be able to trigger cleanup operations manually.

**REQ-CLEANUP-011**: Cleanup operations shall be interruptible and resumable.

---

## 9. Conflict Detection and Resolution Requirements

### 9.1 Conflict Types

**REQ-CONFLICT-001**: The system shall detect the following conflict types:
- **Supersession**: Same entity with different values at different timestamps
- **Contradiction**: Same entity with incompatible values at similar timestamps
- **Partial Overlap**: Different entities with conflicting implications
- **Scope Conflict**: Task-level and project-level memories that disagree

### 9.2 Automatic Resolution

**REQ-CONFLICT-002**: For supersession conflicts, the system shall automatically resolve by preferring newer information and marking older memories as superseded.

**REQ-CONFLICT-003**: For scope conflicts, the system shall prefer project-level memories unless the task explicitly overrides.

**REQ-CONFLICT-004**: Automatic resolutions shall be logged and included in git commit messages.

### 9.3 Human Resolution

**REQ-CONFLICT-005**: For contradiction conflicts that cannot be automatically resolved, the system shall flag them for human review.

**REQ-CONFLICT-006**: The cleanup agent shall surface detected conflicts with:
- Memories involved
- Nature of the conflict
- Suggested resolution options

**REQ-CONFLICT-007**: Users shall be able to resolve flagged conflicts through the Engy interface.

---

## 10. Memory Index Requirements

### 10.1 Index as Acceleration Layer

**REQ-INDEX-001**: The system shall maintain an index derived from memory files to enable fast search and retrieval.

**REQ-INDEX-002**: The index shall not be the source of truth; it shall be rebuildable from memory files at any time.

**REQ-INDEX-003**: The index shall store:
- Memory ID and file path
- File checksum for change detection
- Denormalized metadata for fast filtering
- Vector embeddings for similarity search
- Graph relations for relationship traversal

### 10.2 Index Synchronization

**REQ-INDEX-004**: On system startup, the system shall scan all memory files and reconcile with the index.

**REQ-INDEX-005**: When a memory file changes, the system shall update the corresponding index entry.

**REQ-INDEX-006**: When a memory file is deleted, the system shall remove the corresponding index entry.

**REQ-INDEX-007**: The system shall support full index rebuild from memory files.

### 10.3 Graph-Vector Hybrid Index

**REQ-INDEX-008**: The index shall support both vector similarity queries and graph traversal queries.

**REQ-INDEX-009**: The index shall enable one-hop neighbor expansion for enriching retrieval results.

**REQ-INDEX-010**: The index shall support filtering by project, task, type, keywords, themes, and date ranges.

---

## 11. MCP Tool Interface Requirements

### 11.1 Core Memory Tools

**REQ-MCP-001**: The system shall expose a `create_memory` tool that:
- Accepts content, type, scope, and optional metadata
- Writes the memory file
- Commits to git
- Updates the index
- Returns the memory ID

**REQ-MCP-002**: The system shall expose a `get_memory` tool that:
- Accepts a memory ID
- Reads the file from disk
- Returns the full memory content and metadata

**REQ-MCP-003**: The system shall expose a `list_memories` tool that:
- Accepts filters (project, task, type, etc.)
- Returns metadata only (not full content) for lazy loading
- Supports pagination

**REQ-MCP-004**: The system shall expose a `search_memories` tool that:
- Accepts a query and retrieval mode (local, global, hybrid)
- Accepts scope filters
- Returns ranked results with relevance scores

**REQ-MCP-005**: The system shall expose an `update_memory` tool that:
- Accepts a memory ID and changes
- Updates the file
- Commits to git with diff summary
- Re-indexes

**REQ-MCP-006**: The system shall expose a `delete_memory` tool that:
- Accepts a memory ID
- Removes the file via git
- Updates the index

### 11.2 Research Tools

**REQ-MCP-007**: The system shall expose a `research_memories` tool for deep exploration that:
- Accepts a query and depth parameter
- Performs multi-hop traversal
- Returns comprehensive results

**REQ-MCP-008**: The system shall expose a `find_related` tool that:
- Accepts a memory ID and optional relationship types
- Returns directly linked memories

**REQ-MCP-009**: The system shall expose an `explain_connection` tool that:
- Accepts two memory IDs
- Returns the relationship path between them

### 11.3 Management Tools

**REQ-MCP-010**: The system shall expose a `link_memories` tool that:
- Accepts source ID, target ID, and relationship type
- Creates bidirectional links
- Commits changes

**REQ-MCP-011**: The system shall expose a `supersede_memory` tool that:
- Accepts old ID, new ID, and optional reason
- Updates supersession metadata in both memories
- Commits changes

### 11.4 Access Control

**REQ-MCP-012**: AI agents shall only access memories through MCP tools; direct filesystem access shall not be provided.

**REQ-MCP-013**: All MCP operations shall be auditable through git history.

---

## 12. Human Interface Requirements

### 12.1 Memory Browsing

**REQ-UI-001**: Users shall be able to view all memories for a project organized by scope (project-level vs task-level).

**REQ-UI-002**: Users shall be able to view memories for a specific task.

**REQ-UI-003**: Users shall be able to search memories using the same retrieval capabilities available to AI agents.

**REQ-UI-004**: Users shall be able to filter memories by type, source, date range, and confidence level.

### 12.2 Memory Editing

**REQ-UI-005**: Users shall be able to edit memory content and metadata through the Engy interface.

**REQ-UI-006**: Users shall be able to create new memories through the Engy interface.

**REQ-UI-007**: Users shall be able to delete memories through the Engy interface.

**REQ-UI-008**: Users shall be able to manually create and remove links between memories.

### 12.3 Memory Visualization

**REQ-UI-009**: Users shall be able to view a graph visualization of memory relationships.

**REQ-UI-010**: Users shall be able to view memory history through git integration.

**REQ-UI-011**: Users shall be able to compare memory versions.

### 12.4 Cleanup Review

**REQ-UI-012**: Users shall be able to view pending cleanup agent changes before they are merged.

**REQ-UI-013**: Users shall be able to accept or reject cleanup agent changes.

**REQ-UI-014**: Users shall be able to view flagged conflicts requiring human resolution.

**REQ-UI-015**: Users shall be able to resolve conflicts through the interface.

---

## 13. Task Lifecycle Requirements

### 13.1 Task Completion

**REQ-LIFECYCLE-001**: When a task is completed, task-level memories shall remain in place for historical reference.

**REQ-LIFECYCLE-002**: When a task is completed, the system shall evaluate task memories for potential promotion to project level.

### 13.2 Memory Promotion

**REQ-LIFECYCLE-003**: The system shall support promoting a task memory to project level when it contains knowledge relevant beyond the task.

**REQ-LIFECYCLE-004**: When a memory is promoted:
- A new project-level memory shall be created
- The original task memory shall be marked with `superseded_by` pointing to the new location
- Git shall record the promotion

**REQ-LIFECYCLE-005**: AI agents shall be able to suggest memory promotion; users shall confirm.

### 13.3 Task Archival

**REQ-LIFECYCLE-006**: When a task is archived, its memories shall remain accessible but may be moved to an archive location.

**REQ-LIFECYCLE-007**: Archived task memories shall remain searchable and linkable.

---

## 14. Cross-Reference Requirements

**REQ-XREF-001**: Memories shall be able to reference other memories regardless of scope using the memory ID.

**REQ-XREF-002**: Task memories shall be able to reference project memories.

**REQ-XREF-003**: Project memories shall be able to reference task memories.

**REQ-XREF-004**: Cross-scope references shall be resolved at query time using memory IDs.

**REQ-XREF-005**: When a referenced memory is moved or promoted, references shall remain valid through the ID system.

---

## 15. Non-Functional Requirements

### 15.1 Performance

**REQ-PERF-001**: Memory search operations shall return results within 500ms for typical queries.

**REQ-PERF-002**: Memory creation operations shall complete within 2 seconds including git commit.

**REQ-PERF-003**: The system shall support projects with up to 10,000 memories without significant degradation.

### 15.2 Reliability

**REQ-REL-001**: Memory files shall be recoverable through git history in case of corruption or accidental deletion.

**REQ-REL-002**: The index shall be rebuildable from memory files without data loss.

**REQ-REL-003**: Concurrent access to memories shall be handled safely.

### 15.3 Scalability

**REQ-SCALE-001**: The directory structure shall support subdivision (e.g., by year/month) when memory counts exceed practical limits for flat storage.

**REQ-SCALE-002**: The index shall support efficient queries across large memory collections.

### 15.4 Interoperability

**REQ-INTEROP-001**: Memory files shall be readable and editable with standard text editors.

**REQ-INTEROP-002**: Memory files shall be compatible with Obsidian and other markdown-based knowledge management tools.

**REQ-INTEROP-003**: The git repository shall be compatible with standard git tooling and hosting services.

---

## Appendix A: Memory Type Taxonomy

| Type | Description | Typical Source |
|------|-------------|----------------|
| `decision` | A choice made with rationale | Agent, User |
| `learning` | Knowledge gained from experience | Agent, System |
| `preference` | User or project preference | User, Agent |
| `fact` | Verified information | Agent, User |
| `blocker` | Obstacle encountered | Agent |
| `approach` | Strategy or method used | Agent |
| `discovery` | New finding during work | Agent |
| `question` | Unresolved question for later | Agent, User |
| `summary` | Consolidation of multiple memories | System, Agent |

## Appendix B: Retrieval Mode Selection Guide

| Query Type | Recommended Mode | Example |
|------------|------------------|---------|
| Specific entity lookup | Local | "What is the API rate limit?" |
| Thematic exploration | Global | "How has our caching strategy evolved?" |
| General research | Hybrid | "What should I know before implementing auth?" |
| Relationship tracing | Research subagent | "How did the database decision affect the API design?" |

## Appendix C: References

1. A-MEM: Agentic Memory for LLM Agents (Xu et al., 2025) - https://arxiv.org/abs/2502.12110
2. ACE: Agentic Context Engineering (Zhang et al., 2025) - https://arxiv.org/abs/2510.04618
3. LightRAG: Simple and Fast Retrieval-Augmented Generation - https://arxiv.org/abs/2410.05779
4. Zettelkasten Method - Ahrens, S. (2017). How to Take Smart Notes
5. HybridRAG: Integrating Knowledge Graphs and Vector Retrieval - https://arxiv.org/abs/2408.04948
