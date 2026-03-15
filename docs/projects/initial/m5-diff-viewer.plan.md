---
title: Diff Viewer + Review
status: active
---

----------

# Plan: M5 Diff Viewer + Review

## Context

**M1 (Foundation)** shipped the skeleton: web + client daemon over WebSocket, SQLite/Drizzle schema (workspaces, projects, milestones, task_groups, tasks, agent_sessions, fleeting_memories, project_memories, comments, comment_threads, thread_comments), tRPC API with full CRUD, MCP server, and a navigation shell with empty-state tabs.

**M2 (Spec Authoring)** shipped the specs tab: file tree, BlockNote editor, YAML frontmatter, spec lifecycle, inline comments via comment threads persisted in SQLite, spec tasks, file watcher, MCP spec tools, and the `docsDir` per-workspace feature.

**M3 (Project Planning)** shipped the spec-to-project transition and the full planning model: project lifecycle management, milestone CRUD with status transitions, task groups with `repos` field, three task views (dependency graph, swimlane board, Eisenhower matrix), task detail panel, plan tab with inline BlockNote editor, workspace overview with project cards, and MCP tools for project operations.

**M4 (Terminal Integration)** shipped the Claude Code CLI terminal panel inside Engy: xterm.js with tab-based multi-terminal, WebSocket relay through the daemon, context-scoped terminal auto-start, resizable panel layout, keyboard shortcuts, and send-to-terminal infrastructure.

**M5 (Diff Viewer + Review)** delivers code review inside Engy. Users view diffs in the Project Diffs tab or the Open Directory view, leave line-level comments persisted in SQLite, and send batched feedback to the Claude Code terminal.

### Explicitly Out of Scope for M5

* Worktree management and creation (M7)

* Task group execution lifecycle / state machine (M7)

* Agent sessions / async execution (M10)

* Commit, push, pre-commit gate, PR creation (requires async agents for proper orchestration)

* Knowledge/memory layer (M8)

* Notifications and activity feed (M9)

* Global search / ChromaDB (M8/M9)

* Dev containers (M11)

* PR monitoring / CI status (M12)

***

## New/Modified File Map

```text
common/src/ws/
├── protocol.ts                                    # MODIFY: add git status/diff/log/show WS messages

web/src/
├── server/
│   ├── trpc/
│   │   ├── context.ts                             # MODIFY: add pending git maps to AppState
│   │   └── routers/
│   │       ├── diff.ts                            # NEW: diff tRPC router (status, diff, log, show)
│   │       ├── diff.test.ts                       # NEW: diff router tests
│   │   └── root.ts                                # MODIFY: register diff router
│   └── ws/
│       └── server.ts                              # MODIFY: add git dispatch/response handlers
├── app/
│   ├── open/page.tsx                              # MODIFY: add diff panel toggle
│   └── w/[workspace]/projects/[project]/
│       ├── layout.tsx                             # MODIFY: enable Diffs tab
│       └── diffs/
│           └── page.tsx                           # NEW: diffs page route
├── components/
│   ├── diff/
│   │   ├── types.ts                               # NEW: shared types (ChangedFile, ViewMode, etc.)
│   │   ├── diffs-page.tsx                         # NEW: orchestrator for project diffs tab
│   │   ├── file-list-panel.tsx                    # NEW: reuses TreeView, adds status badges
│   │   ├── diff-viewer-panel.tsx                  # NEW: react-diff-view rendering
│   │   ├── diff-header.tsx                        # NEW: file info, view/comparison toggles
│   │   ├── diff-styles.css                        # NEW: CSS variables for diff colors (dark only)
│   │   ├── comment-widget.tsx                     # NEW: inline comment textarea on diff lines
│   │   ├── use-diff-comments.ts                   # NEW: hook for diff comment CRUD
│   │   ├── view-mode-tabs.tsx                     # NEW: Latest/History/Branch toggle
│   │   ├── commit-list.tsx                        # NEW: commit history list
│   │   ├── repo-selector.tsx                      # NEW: dropdown for repo/dir selection
│   │   ├── review-actions.tsx                     # NEW: Send Feedback + Open in VS Code buttons
│   │   ├── dir-diff-panel.tsx                     # NEW: diff panel for Open Directory
│   │   └── feedback-markdown.ts                   # NEW: generate structured feedback from comments
│   └── terminal/
│       └── use-terminal-scope.ts                  # MODIFY: add diffs scope derivation

client/src/
├── git/
│   ├── index.ts                                   # MODIFY: add diff, log, show ops
│   └── index.test.ts                              # MODIFY: add tests for new git functions
├── ws/
│   └── client.ts                                  # MODIFY: handle new git WS message types
```

***

## Functional Requirements

### Git Protocol Extension (FR 1-4)

1. **Git status request**: New `GIT_STATUS_REQUEST` message (server -> client) with `requestId`, `repoDir`. Client responds with `GIT_STATUS_RESPONSE`: array of `{ path, status, staged }`, current branch name, or error. Status maps git status codes to `added | modified | deleted | renamed`.

2. **Git diff request**: New `GIT_DIFF_REQUEST` message with `requestId`, `repoDir`, `filePath`, optional `base` (ref or branch for comparison). Client responds with `GIT_DIFF_RESPONSE`: unified diff string for the file. Without `base`, returns combined staged + unstaged diff vs HEAD. With `base`, returns `git diff {base} -- {filePath}`.

3. **Git log request**: New `GIT_LOG_REQUEST` message with `requestId`, `repoDir`, `maxCount` (default 50). Client responds with `GIT_LOG_RESPONSE`: array of `{ hash, message, author, date }`.

4. **Git show request**: New `GIT_SHOW_REQUEST` message with `requestId`, `repoDir`, `commitHash`. Client responds with `GIT_SHOW_RESPONSE`: unified diff string for the commit plus array of `{ path, status }` for changed files.

### Diff tRPC Router (FR 5-9)

5. **Get changed files**: `diff.getStatus` query accepts `repoDir` (string). Dispatches `GIT_STATUS_REQUEST` to daemon. Returns `{ files: ChangedFile[], branch: string }`.

6. **Get file diff**: `diff.getFileDiff` query accepts `repoDir`, `filePath`, optional `base`. Dispatches `GIT_DIFF_REQUEST`. Returns `{ diff: string }`.

7. **Get commit log**: `diff.getLog` query accepts `repoDir`, optional `maxCount`. Dispatches `GIT_LOG_REQUEST`. Returns `{ commits: CommitInfo[] }`.

8. **Get commit diff**: `diff.getCommitDiff` query accepts `repoDir`, `commitHash`. Dispatches `GIT_SHOW_REQUEST`. Returns `{ diff: string, files: ChangedFile[] }`.

9. **Get branch diff files**: `diff.getBranchDiff` query accepts `repoDir`, `base` (default `origin/HEAD`). Dispatches `GIT_STATUS_REQUEST` with diff filter against base, then fetches individual file diffs. Returns aggregated file list with diffs.

### UI: File List Panel (FR 10-12)

10. **File tree with path compression**: Changed files displayed using the existing `TreeView` component (`web/src/components/tree-view.tsx`). Single-child directories collapse (`src/components/dev` becomes one node). Files show status badge (A = green, M = blue, D = red) and addition/deletion counts (`+12 -3`). Directories show contained file count.

11. **File selection**: Click a file to select it and load its diff in the viewer panel. Selected file is highlighted. Header shows summary: "N files changed, +A ~M -D".

12. **Refresh button**: Manual refresh triggers a new `GIT_STATUS_REQUEST` to re-fetch changed files.

### UI: Diff Viewer Panel (FR 13-17)

13. **Diff rendering**: Uses `react-diff-view` library with `parse-diff` for parsing unified diff output. Renders `<Diff>` with `<Hunk>` components. Supports syntax highlighting via `refractor` tokenization.

14. **Split and unified view modes**: Toggle between side-by-side (split) and inline (unified) views. Default is split. Persisted in component state.

15. **Dark mode CSS variables**: Diff colors use CSS custom properties scoped to `.diff-viewer`. Green for insertions, red for deletions, with dark-mode-appropriate background and text colors. Syntax highlighting tokens styled for dark backgrounds.

16. **Empty states**: "No file selected" when no file is clicked. "No changes detected" when a file has no diff. "Unable to parse diff" on parse errors.

17. **Gutter comment button**: On line hover, the gutter shows a "+" button. Clicking opens the inline comment widget for that line.

### UI: Line-Level Commenting (FR 18-22)

18. **Comment widget**: Inline textarea below the diff line. Save (Ctrl+Enter), Cancel (Esc), Delete buttons. Uses shadcn Button and Textarea components. Adapts the engy3 `CommentWidget` pattern.

19. **DB persistence via comment threads**: Comments stored using existing `commentThreads` + `threadComments` tables. The `documentPath` field encodes diff context as `diff://{repoDir}/{filePath}` — the `diff://` prefix ensures these are isolated from document comments (which use filesystem paths). The `metadata` JSON stores `{ type: 'diff', lineNumber, side, changeKey, codeLine }`. The existing `listThreads` query already filters by `documentPath`, so diff comments and doc comments never mix.

20. **Comment CRUD hook**: `useDiffComments(repoDir)` hook wraps `trpc.comment.createThread`, `trpc.comment.addComment`, `trpc.comment.resolveThread`, `trpc.comment.deleteThread`. Lists threads filtered by `documentPath` prefix `diff://{repoDir}/`.

21. **Widget integration**: Comments render as `react-diff-view` widgets keyed by `getChangeKey()`. Existing comments display below their line. New comment widget appears on gutter click.

22. **Thread support**: Each line comment is a thread. Users can reply to existing comments (add to thread). Threads can be resolved or deleted.

### UI: Diffs Page Assembly (FR 23-29)

23. **Three view modes**: Tab bar with Latest Changes (default), Commit History, and Branch Diff. The active mode determines which data source and layout to use.

24. **Latest Changes mode**: Shows uncommitted working tree changes. Fetches `diff.getStatus` for the selected repo. File list on left, diff viewer on right. This is the default view.

25. **Commit History mode**: Shows recent commits via `diff.getLog`. Left panel displays commit list (hash, message, author, date). Click a commit to load its diff via `diff.getCommitDiff`. Right panel shows that commit's file list and diff.

26. **Branch Diff mode**: Shows all changes vs a base branch. Default base is `origin/HEAD`, editable via text input. Fetches `diff.getBranchDiff`. Same file list + diff layout as Latest Changes but against the base ref.

27. **Repo selector**: Dropdown to select which repo directory to diff. Sources repos from three places in priority order: (1) task group `repos` if a task group is selected and has repos configured, (2) workspace `repos`, (3) workspace/project `docsDir` (also a git directory). When only one repo is available, the selector is hidden and that repo is auto-selected. When multiple repos exist, the selector shows all available directories.

28. **Resizable layout**: File list and diff viewer in a horizontally resizable split using shadcn ResizablePanelGroup. File list defaults to ~280px, min 200px.

29. **Enable Diffs tab**: Project layout enables the Diffs tab (currently disabled with hint "Available in M6"). Route `/w/{workspace}/projects/{project}/diffs` renders the diffs page.

### UI: Review Actions (FR 30-33)

30. **Send Feedback button**: Collects all unresolved comment threads for the current diff context, generates structured markdown (file-grouped, line-referenced, with code context), and sends to the active terminal via `useSendToTerminal`. Comments are NOT resolved after sending — they remain visible for continued review.

31. **Open in VS Code button**: Opens the currently diffed repo/directory in VS Code via `code {repoDir}`. Available whenever a repo is selected in the diff viewer.

32. **Feedback markdown format**: Structured markdown grouped by file, sorted by line number. Each entry includes: file path, line number, code context (the diff line), and comment text. Includes summary header with total comments and files count.

33. **Copy Feedback button**: Copies the same structured feedback markdown to clipboard. Useful when the terminal is not active or the user wants to paste feedback elsewhere.

### UI: Open Directory Integration (FR 34-35)

34. **Diff panel in Open Directory**: The `/open` page gains a "Diffs" toggle/tab alongside the existing file editor. When active, shows the diff viewer for the open directory's git repo (if it's a git repo). Uses the same diff components (file list, viewer, comments) scoped to the open directory path.

35. **Git detection**: On Open Directory, check if the path is inside a git repo. If yes, enable the diff panel. If not, hide the diff toggle.

### Document Feedback Routing (FR 36)

36. **Unified feedback model**: Inline comments from the M2 document editor (specs, docs) now support the same Send Feedback flow as diff comments. The existing `SendToTerminalButton` on the comments sidebar batches document comments into structured markdown and routes to the terminal. This is already partially implemented — M5 ensures the format includes file path and line references.

***

## Behavioral Requirements

### Git Protocol

```gherkin
Feature: Git operations via WebSocket
  Git commands flow through the daemon for repo isolation.

  Scenario: Get changed files (FR #1, #5)
    Given the client daemon is connected
    And repo "/Users/me/repo" has 3 modified files
    When I call diff.getStatus({ repoDir: "/Users/me/repo" })
    Then I receive { files: [3 ChangedFile entries], branch: "feature/xyz" }

  Scenario: Get file diff (FR #2, #6)
    Given file "src/app.ts" is modified in "/Users/me/repo"
    When I call diff.getFileDiff({ repoDir: "/Users/me/repo", filePath: "src/app.ts" })
    Then I receive { diff: "--- a/src/app.ts\n+++ b/src/app.ts\n..." }

  Scenario: Get branch diff (FR #2, #9)
    Given branch "feature/xyz" has 5 changed files vs origin/HEAD
    When I call diff.getBranchDiff({ repoDir: "/Users/me/repo", base: "origin/HEAD" })
    Then I receive 5 files with their diffs against origin/HEAD

  Scenario: Get commit history (FR #3, #7)
    Given the repo has 100 commits
    When I call diff.getLog({ repoDir: "/Users/me/repo", maxCount: 20 })
    Then I receive the 20 most recent commits

  Scenario: Get commit diff (FR #4, #8)
    Given commit "abc123" modified 2 files
    When I call diff.getCommitDiff({ repoDir: "/Users/me/repo", commitHash: "abc123" })
    Then I receive the unified diff and 2 changed file entries

  Scenario: Daemon not connected
    Given no daemon is connected
    When I call any diff query
    Then it fails with "No daemon connected"
```

### Diff Viewer UI

```gherkin
Feature: Diff viewer interaction
  Users browse diffs and leave comments.

  Scenario: View latest changes (FR #24)
    Given I open the Diffs tab for a project
    Then I see "Latest Changes" mode active
    And the file list shows uncommitted changes
    When I click a file
    Then its diff renders in the viewer panel

  Scenario: Toggle view mode (FR #14)
    Given a diff is displayed in split view
    When I click the "Unified" toggle
    Then the diff renders in unified (inline) mode

  Scenario: Leave a line comment (FR #17, #18, #19)
    Given a diff is displayed
    When I hover over a line's gutter
    Then a "+" button appears
    When I click "+"
    Then a comment textarea opens below the line
    When I type "This needs error handling" and press Ctrl+Enter
    Then the comment is saved to the database
    And displays inline below the line

  Scenario: Send feedback to terminal (FR #30)
    Given I have 3 unresolved comments across 2 files
    When I click "Send Feedback"
    Then structured markdown is generated with file/line references
    And the content is injected into the active terminal
    And comments remain unresolved (not auto-resolved)

  Scenario: Switch to commit history (FR #25)
    When I click the "Commit History" tab
    Then I see a list of recent commits
    When I click a commit
    Then its changed files and diff are displayed

  Scenario: Branch diff with custom base (FR #26)
    When I click the "Branch Diff" tab
    Then I see diffs against origin/HEAD
    When I change the base to "origin/develop"
    Then diffs refresh against origin/develop

  Scenario: Switch repos (FR #27)
    Given a workspace with 3 repos configured
    When I open the Diffs tab
    Then I see a repo selector dropdown
    When I select a different repo
    Then the file list and diffs refresh for that repo
```

### Open Directory Integration

```gherkin
Feature: Diffs in Open Directory
  The Open Directory view supports diff viewing for git repos.

  Scenario: Git repo detected (FR #34, #35)
    Given I open directory "/Users/me/my-repo" which is a git repo
    Then a "Diffs" toggle appears alongside the file editor
    When I activate the diff panel
    Then I see changed files and can view diffs

  Scenario: Non-git directory (FR #35)
    Given I open directory "/Users/me/notes" which is not a git repo
    Then no diff toggle appears
```

***

## Key Decisions

1. **react-diff-view library**: Proven in the engy3 implementation. Provides split/unified modes, `renderGutter` for comment buttons, and widget system for inline comments. `parse-diff` handles unified diff parsing. Together ~45kb. No need for heavier alternatives.

2. **Comment model reuse with isolation**: Diff comments use the existing `commentThreads` + `threadComments` tables. The `documentPath` field encodes diff context with a `diff://` prefix (`diff://{repoDir}/{filePath}`), ensuring complete isolation from document comments (which use filesystem paths). The `metadata` JSON stores line number and change key. No schema migration needed.

3. **Git operations via daemon relay**: All git commands go through WebSocket to the client daemon, following the established pattern (like `VALIDATE_PATHS_REQUEST`). The server never touches repos directly. Each operation has a request/response pair with `requestId` for matching.

4. **Repo selector with multiple sources**: The diff viewer can diff any repo from: task group `repos`, workspace `repos`, or workspace/project `docsDir`. When only one repo is available, the selector is hidden. This accommodates workspaces with multiple code repos and also treats docs directories as diffable git repos.

5. **Open Directory diff panel**: Adds a toggle to the existing `/open` page rather than a separate route. Reuses the same diff components, scoped to the open directory path. Only shows if the directory is a git repo.

6. **Dark mode only CSS**: The diff viewer CSS only includes dark mode colors (no light mode), matching the project's dark-mode-only design system.

7. **No syntax highlighting in initial delivery**: The engy3 implementation uses `refractor` for syntax tokenization. This can be added as a fast follow but is not required for the core diff review experience. Plain diff rendering with insertion/deletion colors ships first.

8. **Feedback does not resolve comments**: When feedback is sent to terminal, comments remain unresolved. The user decides when to resolve them manually. This avoids losing review context.

9. **Commit/push/PR deferred**: Commit, push, pre-commit gate, and PR creation are deferred to the milestone that adds async agents, where they can be orchestrated properly with agent feedback loops.

***

## Implementation Phases

Each phase delivers a complete, testable vertical slice touching all necessary layers (protocol → client → server → UI).

### Phase 1: View Uncommitted Changes (Latest Changes)

**Outcome**: User navigates to Diffs tab, sees changed files, clicks one, and views its diff in split or unified mode.

**All layers**:

* **Protocol**: Add `GIT_STATUS_REQUEST/RESPONSE` and `GIT_DIFF_REQUEST/RESPONSE` to `common/src/ws/protocol.ts`

* **Client**: Add `getStatusDetailed(dir)` and `getDiff(dir, filePath, base?)` to `client/src/git/index.ts`, wire handlers in `client/src/ws/client.ts`

* **Server**: Add pending maps to AppState, dispatch/response handlers in `web/src/server/ws/server.ts`, create `diff.getStatus` and `diff.getFileDiff` queries in `web/src/server/trpc/routers/diff.ts`, register in `root.ts`

* **UI**: Install `react-diff-view` + `parse-diff`, create shared types (`types.ts`), file list panel (reuse `TreeView` with status badges), diff viewer panel (split/unified toggle, dark-mode CSS), diff header, repo selector, diffs page orchestrator, enable Diffs tab in project layout

### Phase 2: Line-Level Commenting on Diffs

**Outcome**: User hovers a line gutter, clicks "+", types a comment, saves it. Comment persists in DB and displays inline below the line.

**All layers**:

* **Server**: Existing comment tRPC endpoints used with `diff://` prefix for `documentPath` isolation — no new endpoints needed, just verify filtering works

* **UI**: Comment widget (shadcn styled textarea, save/cancel/delete), `useDiffComments` hook wrapping existing comment tRPC endpoints with `diff://{repoDir}/{filePath}` encoding, wire into `react-diff-view` widget system via `getChangeKey`, gutter "+" button via `renderGutter`

### Phase 3: Commit History and Branch Diff

**Outcome**: User switches to Commit History tab, sees commits, clicks one to view its diff. User switches to Branch Diff tab, sees changes vs `origin/HEAD`, can change the base branch.

**All layers**:

* **Protocol**: Add `GIT_LOG_REQUEST/RESPONSE` and `GIT_SHOW_REQUEST/RESPONSE` to protocol

* **Client**: Add `getLog(dir, maxCount?)` and `getShow(dir, commitHash)` to git functions, wire handlers

* **Server**: Add `diff.getLog`, `diff.getCommitDiff`, and `diff.getBranchDiff` queries to diff router

* **UI**: View mode tabs (Latest/History/Branch), commit list component, base branch text input, wire into diffs page

### Phase 4: Review Actions — Send Feedback + Open in VS Code

**Outcome**: User clicks "Send Feedback" and structured markdown with file/line references is injected into the active terminal. Comments remain unresolved. User clicks "Open in VS Code" to open the repo directory.

**All layers**:

* **UI**: Feedback markdown generator (`feedback-markdown.ts` with tests), Send Feedback button (uses `useSendToTerminal`, does NOT resolve comments), Copy Feedback button (clipboard), Open in VS Code button (`code {repoDir}`), wire into diffs page header

### Phase 5: Diffs in Open Directory

**Outcome**: User opens a git directory via Open Directory, sees a "Diffs" toggle, activates it, and can view/comment on diffs just like the project Diffs tab.

**All layers**:

* **Server**: Git detection query (check if open directory is a git repo)

* **UI**: `DirDiffPanel` wrapper reusing diff components scoped to the open directory path, diff toggle on `/open` page, hidden for non-git directories

### Phase 6: Polish + Quality Gate

1. Run `pnpm blt` — fix knip, jscpd, coverage issues

2. Dark mode CSS verification

3. Terminal integration end-to-end test (send feedback → terminal)

4. Final `pnpm blt` pass

***

## Out of Scope

| Feature                                    | Milestone    |
| ------------------------------------------ | ------------ |
| Commit, push, pre-commit gate, PR creation | Async agents |
| Worktree creation/management               | M7           |
| Task group execution lifecycle             | M7           |
| Agent sessions / async execution           | M10          |
| Knowledge/memory layer                     | M8           |
| Activity feed / notifications              | M9           |
| Global search                              | M8/M9        |
| Dev containers                             | M11          |
| PR monitoring / CI status                  | M12          |
| Reviewer comment triage                    | M12          |
| Syntax highlighting (can be fast-followed) | Enhancement  |

***

## Dependencies to Add

| Package           | Target | Purpose                                                  |
| ----------------- | ------ | -------------------------------------------------------- |
| `react-diff-view` | web    | Diff rendering (split/unified, widgets, gutter hooks)    |
| `parse-diff`      | web    | Parse unified diff format into structured hunks          |
| `refractor`       | web    | Optional: syntax highlighting tokenization for diff code |

***

## Verification

1. `pnpm blt` passes

2. Navigate to project Diffs tab -> file list shows uncommitted changes

3. Click a file -> diff renders in split view

4. Toggle to unified view -> diff re-renders inline

5. Hover a line gutter -> "+" button appears

6. Click "+" -> comment textarea opens, type and Ctrl+Enter -> comment saved and visible

7. Click "Send Feedback" -> structured markdown injected into active terminal, comments remain unresolved

8. Switch to Commit History tab -> commits listed, click one -> its diff displays

9. Switch to Branch Diff tab -> shows diff vs origin/HEAD

10. Change base branch -> diff refreshes

11. Click Open in VS Code -> opens the current repo/directory in VS Code

12. Repo selector shows when workspace has multiple repos, switching refreshes diffs

13. Open a git directory via Open Directory -> diff toggle visible, diff panel works

14. Open a non-git directory -> no diff toggle

15. Diff comments do not appear in document comment threads (isolation verified)
