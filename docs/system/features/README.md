---
description: Major feature areas of the workspace
---

One doc per major feature area, ordered for top-to-bottom reading. Each doc carries a prose body plus a `## Requirements` table of EARS functional requirements (the single source of truth for that area's behaviour); the FR ids are tagged into the verifying tests so `trace` / `engy:validate` can report coverage.

<!-- INDEX START -->

- [search.md](search.md) — Hybrid search across collections, structured filters, and query-shape reranking.
- [workspace-management.md](workspace-management.md) — Workspace lifecycle — create, read, update, delete, directory scaffold, git init, and daemon sync.
- [project-management.md](project-management.md) — Project lifecycle, spec.md state machine, file tree and context file CRUD, plan slug enumeration, and the two-step completion/archive flow.
- [task-management.md](task-management.md) — Task and task-group lifecycle, dependency graph, Eisenhower fields, bulk operations, and MCP surface.
- [milestone-management.md](milestone-management.md) — Milestone lifecycle — create, list, get, update (status transitions, title rename, scope\), and delete of filesystem-backed plan files.
- [execution-engine.md](execution-engine.md) — Agent session lifecycle — start, stop, retry, feedback, completion handling, spawn modes, auto-start, and remote execution.
- [terminal-relay.md](terminal-relay.md) — PTY session lifecycle — spawn, suspend/resume, multi-attach, kill, expiry, activity tracking, and daemon-sync across reconnects.
- [container-management.md](container-management.md) — Devcontainer and Coder workspace lifecycle — start, stop, status, exec, and config generation.
- [git-and-worktree.md](git-and-worktree.md) — Git status, log, diff, and commit inspection on user repos, plus worktree lifecycle management across multi-repo workspaces.
- [memory-management.md](memory-management.md) — Two-tier memory system — fleeting captures and durable permanent notes — with file-backed persistence, git commits, README indexing, and auto-linking.
- [document-editor.md](document-editor.md) — BlockNote-based rich document editor with inline comments, mermaid diagrams, and markdown persistence.
- [file-and-dir-browser.md](file-and-dir-browser.md) — Daemon-proxied user-repo file access and server-local engy-dir file operations.
- [agent-question-protocol.md](agent-question-protocol.md) — Protocol for agents to pause execution and ask the user batched questions, then resume automatically on answer.
- [websocket-daemon-protocol.md](websocket-daemon-protocol.md) — Daemon registration, request/response dispatch, FILE_CHANGE buffering, and browser broadcast over the /ws control channel.
- [mcp-server-session.md](mcp-server-session.md) — MCP HTTP session lifecycle, transport management, idle reaper, response envelope, and trace tool.

<!-- INDEX END -->
