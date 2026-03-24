---
title: Terminal Integration
status: complete
---

# Plan: M5 Terminal Integration

## Context

**M1 (Foundation)** shipped the skeleton: web + client daemon over WebSocket, SQLite/Drizzle schema (workspaces, projects, milestones, task_groups, tasks, agent_sessions, fleeting_memories, project_memories, comments, comment_threads, thread_comments), tRPC API with full CRUD, MCP server, and a navigation shell with empty-state tabs.

**M2 (Spec Authoring)** shipped the specs tab: file tree, BlockNote editor, YAML frontmatter, spec lifecycle (draft -> ready -> approved), inline comments via comment threads, spec tasks, file watcher, MCP spec tools, and the `docsDir` per-workspace feature.

**M3 (Open Directory)** shipped lightweight quick-open mode: open any directory from Home, browse/edit markdown files, `dir` tRPC router, recent directories in localStorage.

**M4 (Project Planning)** shipped the spec-to-project transition and the full planning model: project lifecycle management, milestone CRUD with status transitions (planned -> planning -> active -> complete), task groups, three task views (dependency graph, swimlane board, Eisenhower matrix), task detail panel, plan tab with inline BlockNote editor, workspace overview with project cards, MCP tools for project operations, and three Claude Code skills (project-assistant, workspace-assistant, planning).

**M5 (Terminal Integration)** delivers the Claude Code CLI terminal panel inside Engy — the action layer that turns the visual UI into a two-panel experience: visual state on the left, terminal for action on the right.

### Explicitly Out of Scope for M5

- Diff viewer (M6)
- Worktree management (M7)
- Knowledge/memory layer (M8)
- Notifications and activity feed (M9)
- Global search / ChromaDB (M8/M9)
- Agent sessions / async execution (M10)
- PR monitoring (M12)
- Dev containers (M11)
- Feedback routing from diff viewer to terminal (M6 — M5 only provides the terminal itself)

---

## New/Modified File Map

```
common/src/ws/
├── protocol.ts                                    # MODIFY: add terminal WS message types

web/src/
├── server/
│   ├── trpc/
│   │   ├── context.ts                             # MODIFY: add terminalSessions map to AppState
│   │   └── routers/
│   │       ├── terminal.ts                        # NEW: terminal session tRPC router
│   │       └── terminal.test.ts                   # NEW: terminal router tests
│   │   └── root.ts                                # MODIFY: register terminal router
│   └── ws/
│       └── server.ts                              # MODIFY: handle terminal WS messages (relay I/O)
├── app/
│   ├── layout.tsx                                 # MODIFY: wrap children with TerminalProvider
│   └── w/[workspace]/
│       ├── layout.tsx                             # MODIFY: wrap with TerminalShell (main + panel)
│       ├── projects/[project]/layout.tsx          # MODIFY: pass terminal scope context
│       ├── specs/page.tsx                         # MODIFY: pass terminal scope for specs
│       └── tasks/page.tsx                         # MODIFY: pass terminal scope for default project
├── components/
│   ├── terminal/
│   │   ├── terminal-provider.tsx                  # NEW: React context for terminal state mgmt
│   │   ├── terminal-shell.tsx                     # NEW: resizable main + terminal panel layout
│   │   ├── terminal-panel.tsx                     # NEW: panel with tab bar + terminal views
│   │   ├── terminal-tab.tsx                       # NEW: single xterm.js terminal instance
│   │   ├── terminal-tab-bar.tsx                   # NEW: tab strip with add/close/metadata
│   │   ├── use-terminal-scope.ts                  # NEW: hook that derives scope from route
│   │   └── types.ts                               # NEW: terminal scope types
│   └── ui/
│       └── resizable.tsx                          # NEW: shadcn resizable (PanelGroup/Panel/Handle)

client/src/
├── index.ts                                       # MODIFY: wire terminal process manager
├── ws/client.ts                                   # MODIFY: handle terminal WS messages
├── terminal/
│   ├── manager.ts                                 # NEW: Claude Code CLI process management
│   ├── manager.test.ts                            # NEW: process manager tests
│   └── types.ts                                   # NEW: terminal session types for client
```

---

## Functional Requirements

### WebSocket Protocol Extension (FR 1-4)

1. **Terminal spawn message**: New `TERMINAL_SPAWN_REQUEST` message (server -> client) with: `sessionId` (UUID), `workingDir` (absolute path), `agentName` (optional skill name), `cols`/`rows` (terminal dimensions), `scopeMetadata` (JSON with scope type and label). The client daemon spawns a Claude Code CLI process with the given parameters.

2. **Terminal data relay**: New `TERMINAL_DATA` message (bidirectional) with: `sessionId`, `data` (base64-encoded terminal bytes). Server relays between browser WebSocket and client daemon. Client relays between daemon WebSocket and pty process.

3. **Terminal resize message**: New `TERMINAL_RESIZE` message (server -> client) with: `sessionId`, `cols`, `rows`. Client resizes the pty process.

4. **Terminal exit message**: New `TERMINAL_EXIT` message (client -> server) with: `sessionId`, `exitCode`. Sent when the CLI process exits. Server notifies the browser to update tab state.

### Terminal Session Registry (FR 5-8)

5. **In-memory session registry**: AppState gains a `terminalSessions` map keyed by `sessionId`. Each entry stores: `sessionId`, `workspaceSlug`, `scopeType` (spec/project/workspace/docs/dir), `scopeLabel`, `workingDir`, `agentName`, `status` (active/exited), `createdAt`.

6. **Terminal session list**: tRPC `terminal.list` query returns all active terminal sessions for a workspace slug. Used by the UI to restore tabs on page load.

7. **Terminal session create**: tRPC `terminal.create` mutation registers a new session in the registry and sends `TERMINAL_SPAWN_REQUEST` to the daemon. Returns the `sessionId`. Validates the daemon is connected.

8. **Terminal session kill**: tRPC `terminal.kill` mutation sends a `TERMINAL_KILL` message to the daemon. The daemon kills the process and responds with `TERMINAL_EXIT`. Server removes the session from the registry.

### Client Process Management (FR 9-13)

9. **Process spawning**: The client daemon uses `node-pty` to spawn Claude Code CLI processes. Each process runs in the specified `workingDir` with the shell set to `claude` (or the configured CLI path). If an `agentName` is provided, it is passed as a `--resume` or skill flag.

10. **PTY I/O bridge**: Data from the pty is base64-encoded and sent as `TERMINAL_DATA` to the server. Data from the server `TERMINAL_DATA` is decoded and written to the pty stdin.

11. **PTY resize**: On `TERMINAL_RESIZE`, the client calls `pty.resize(cols, rows)`.

12. **Process cleanup**: On pty exit, the client sends `TERMINAL_EXIT` with the exit code and cleans up the pty reference. On daemon shutdown, all active pty processes are killed.

13. **Process kill**: On `TERMINAL_KILL`, the client sends SIGTERM to the pty process, waits 3 seconds, then SIGKILL if still running. Sends `TERMINAL_EXIT` after cleanup.

### UI: Terminal Panel (FR 14-22)

14. **Terminal provider (React context)**: Global context that holds: list of open terminal tabs, active tab ID, panel collapsed state, panel width. Provides methods: `openTerminal(scope)`, `closeTerminal(sessionId)`, `setActiveTab(sessionId)`, `togglePanel()`. State persists across page navigations (context lives in the root layout).

15. **Terminal shell (layout wrapper)**: A resizable two-panel layout used inside the workspace layout. Left panel = main content (`children`), right panel = terminal panel. Uses shadcn ResizablePanelGroup with a drag handle. The right panel has a configurable default width (40%) and min width (200px). When collapsed, the right panel has zero size and the handle is hidden.

16. **Terminal panel**: Contains the tab bar at the top and the active terminal view below. When no terminals are open, shows an empty state with "Open a terminal" button. The panel header has a collapse toggle button.

17. **Terminal tab bar**: Horizontal tab strip. Each tab shows: scope icon + label (e.g., "spec: auth-revamp"), close button. "+" button to open a new terminal scoped to the current page. Active tab is highlighted.

18. **Terminal tab (xterm instance)**: Each tab wraps an `xterm.js` Terminal instance. The terminal connects to the server WebSocket for I/O relay. Uses `xterm-addon-fit` to auto-resize the terminal to fit its container. Uses `xterm-addon-web-links` for clickable URLs.

19. **Scope derivation hook**: `useTerminalScope()` reads the current route (via `usePathname` + `useParams`) and derives: `scopeType`, `scopeLabel`, `workingDir` (resolved via tRPC queries for workspace/project data), `agentName`. Scope rules:
    - `/w/{workspace}/specs` with spec selected -> `{ type: 'spec', label: 'spec: {slug}', agentName: 'engy:spec-assistant' }`
    - `/w/{workspace}/projects/{project}` -> `{ type: 'project', label: 'project: {slug}', agentName: 'engy:project-assistant' }`
    - `/w/{workspace}/tasks` -> `{ type: 'workspace', label: 'tasks: {workspace}', agentName: 'engy:workspace-assistant' }`
    - `/w/{workspace}/docs` -> `{ type: 'docs', label: 'docs: {workspace}', agentName: 'engy:sysdoc-assistant' }`
    - Other pages -> `{ type: 'workspace', label: '{workspace}', agentName: null }`

20. **Terminal collapse/expand**: Keyboard shortcut (Ctrl+` / Cmd+`) toggles the terminal panel. Toggle button in the panel header. Collapsed state persists in the provider context.

21. **Terminal auto-open on page navigation**: When navigating to a scoped page (specs with a spec selected, project page, tasks page, docs page), if no terminal tab matches that scope, offer to open one (do not auto-open — just highlight the "+" button). The user must explicitly open terminals.

22. **Scope persistence**: Open terminal tabs maintain their scope when the user navigates to different pages. The xterm instance stays alive in the DOM (hidden via CSS when not the active tab, not unmounted). Sessions survive page changes because the terminal provider lives in the root layout.

### WebSocket Browser Connection (FR 23-25)

23. **Browser WebSocket**: The terminal provider establishes a single WebSocket connection to `/ws/terminal` (new endpoint) on mount. All terminal I/O for all tabs is multiplexed over this single connection using `sessionId` routing.

24. **Browser -> server data flow**: When the user types in xterm, the `onData` callback base64-encodes the input and sends it as `TERMINAL_DATA` over the browser WebSocket. The server identifies the target daemon connection and forwards it.

25. **Server -> browser data flow**: When terminal output arrives from the daemon as `TERMINAL_DATA`, the server forwards it to the browser WebSocket. The terminal provider routes it to the correct xterm tab by `sessionId`.

---

## Behavioral Requirements

### WebSocket Protocol

```gherkin
Feature: Terminal WebSocket messages
  Terminal I/O flows through WebSocket between browser, server, and client daemon.

  Scenario: Spawn terminal session (FR #1, #7)
    Given the client daemon is connected
    When the UI calls terminal.create with scope "spec: auth-revamp"
    Then the server registers the session in AppState
    And sends TERMINAL_SPAWN_REQUEST to the daemon
    And the daemon spawns a Claude Code CLI process in the spec's directory

  Scenario: Terminal data relay (FR #2, #10, #24, #25)
    Given an active terminal session "abc-123"
    When the user types "hello" in the xterm instance
    Then the browser sends TERMINAL_DATA { sessionId: "abc-123", data: <base64> }
    And the server forwards it to the daemon
    And the daemon writes it to the pty stdin
    When the pty produces output
    Then the daemon sends TERMINAL_DATA to the server
    And the server forwards it to the browser
    And xterm renders the output

  Scenario: Terminal resize (FR #3, #11)
    Given an active terminal session
    When the user resizes the terminal panel
    Then the browser sends TERMINAL_RESIZE with new cols/rows
    And the daemon resizes the pty process

  Scenario: Terminal exit (FR #4, #12)
    Given an active terminal session
    When the Claude Code CLI process exits with code 0
    Then the daemon sends TERMINAL_EXIT { sessionId, exitCode: 0 }
    And the server marks the session as exited
    And the UI shows "Process exited" in the tab

  Scenario: Kill terminal session (FR #8, #13)
    Given an active terminal session
    When the UI calls terminal.kill
    Then the server sends TERMINAL_KILL to the daemon
    And the daemon sends SIGTERM to the pty process
    And after exit, sends TERMINAL_EXIT
    And the server removes the session from the registry
```

### Terminal Session Registry

```gherkin
Feature: Terminal session management
  The server tracks active terminal sessions in memory.

  Scenario: List active sessions for workspace (FR #6)
    Given 3 terminal sessions for workspace "engy" (2 active, 1 exited)
    When I call terminal.list({ workspaceSlug: "engy" })
    Then it returns 2 active sessions with their scope metadata

  Scenario: Create session validates daemon connection (FR #7)
    Given no daemon is connected
    When I call terminal.create
    Then it fails with "No daemon connected"

  Scenario: Create session with scope metadata (FR #7)
    Given the daemon is connected
    When I call terminal.create with scopeType "spec" and scopeLabel "spec: auth-revamp"
    Then the session is registered in AppState.terminalSessions
    And a TERMINAL_SPAWN_REQUEST is sent to the daemon

  Scenario: Kill removes session from registry (FR #8)
    Given an active terminal session "abc-123"
    When I call terminal.kill({ sessionId: "abc-123" })
    Then "abc-123" is no longer in AppState.terminalSessions
```

### Client Process Management

```gherkin
Feature: Claude Code CLI process management
  The client daemon manages pty processes for terminal sessions.

  Scenario: Spawn process with working directory (FR #9)
    Given a TERMINAL_SPAWN_REQUEST for dir "/home/user/repo"
    When the manager spawns the process
    Then the pty runs in "/home/user/repo"
    And the shell is set to "claude" (or configured CLI path)

  Scenario: Process output is relayed (FR #10)
    Given an active pty process
    When the process outputs text
    Then the manager sends TERMINAL_DATA to the server with base64-encoded data

  Scenario: Process receives input (FR #10)
    Given an active pty process
    When the manager receives TERMINAL_DATA from the server
    Then the decoded data is written to the pty stdin

  Scenario: Process exit cleanup (FR #12)
    Given an active pty process
    When the process exits with code 0
    Then the manager removes the pty from its map
    And sends TERMINAL_EXIT to the server

  Scenario: Daemon shutdown kills all processes (FR #12)
    Given 3 active pty processes
    When the daemon shuts down
    Then all 3 processes are killed
    And TERMINAL_EXIT is sent for each

  Scenario: Kill request with timeout (FR #13)
    Given an active pty process
    When the manager receives TERMINAL_KILL
    Then it sends SIGTERM to the process
    And waits up to 3 seconds
    If the process is still running after 3 seconds
    Then it sends SIGKILL
```

### UI: Terminal Panel

```gherkin
Feature: Terminal panel UI
  The right-side terminal panel hosts xterm.js tabs.

  Scenario: Panel layout with resizable handle (FR #15)
    Given I am on a workspace page
    Then the layout has a main content area (left) and terminal panel (right)
    And the divider is draggable to resize

  Scenario: Open new terminal from tab bar (FR #17, #19)
    Given I am on the specs page with spec "auth-revamp" selected
    When I click the "+" button in the terminal tab bar
    Then a new terminal tab opens with label "spec: auth-revamp"
    And the terminal connects and starts the engy:spec-assistant agent

  Scenario: Switch between terminal tabs (FR #17)
    Given 2 open terminal tabs
    When I click on the second tab
    Then its xterm instance becomes visible
    And the first tab's instance is hidden (not destroyed)

  Scenario: Close terminal tab (FR #17)
    Given a terminal tab for session "abc-123"
    When I click the tab's close button
    Then terminal.kill is called for "abc-123"
    And the tab is removed from the tab bar

  Scenario: Collapse and expand terminal (FR #20)
    Given the terminal panel is visible
    When I press Ctrl+` (or Cmd+` on Mac)
    Then the terminal panel collapses to zero width
    When I press the shortcut again
    Then the terminal panel expands to its previous width

  Scenario: Terminal persists across navigation (FR #22)
    Given I have a terminal tab open on the specs page
    When I navigate to the tasks page
    Then the terminal tab is still open and connected
    And the xterm session is uninterrupted

  Scenario: Empty state when no terminals (FR #16)
    Given no terminal tabs are open
    When the terminal panel is visible
    Then it shows "No terminals open" with "Open Terminal" button

  Scenario: Terminal auto-fits on resize (FR #18)
    Given an open terminal tab
    When I drag the panel handle to make it wider
    Then the xterm instance resizes to fill the new dimensions
    And a TERMINAL_RESIZE message is sent
```

### Scope Derivation

```gherkin
Feature: Context-scoped terminal
  Terminals open with scope matching the current page.

  Scenario: Spec page scope (FR #19)
    Given I am on /w/engy/specs with spec "auth-revamp" selected
    When I derive terminal scope
    Then scopeType is "spec" and agentName is "engy:spec-assistant"

  Scenario: Project page scope (FR #19)
    Given I am on /w/engy/projects/auth-revamp
    When I derive terminal scope
    Then scopeType is "project" and agentName is "engy:project-assistant"

  Scenario: Workspace tasks page scope (FR #19)
    Given I am on /w/engy/tasks
    When I derive terminal scope
    Then scopeType is "workspace" and agentName is "engy:workspace-assistant"

  Scenario: Docs page scope (FR #19)
    Given I am on /w/engy/docs
    When I derive terminal scope
    Then scopeType is "docs" and agentName is "engy:sysdoc-assistant"
```

---

## Implementation Phases

### Phase 1: WebSocket Protocol Extension

**Files**: `common/src/ws/protocol.ts`

**TDD Steps:**
1. Add new message types to the discriminated union: `TERMINAL_SPAWN_REQUEST`, `TERMINAL_DATA`, `TERMINAL_RESIZE`, `TERMINAL_KILL`, `TERMINAL_EXIT`.
2. Update `ServerToClientMessage` to include `TERMINAL_SPAWN_REQUEST` and `TERMINAL_KILL`.
3. Add new union type `BrowserToServerMessage` for messages from the browser WebSocket (distinct from the daemon WebSocket).
4. Update `ClientToServerMessage` to include `TERMINAL_DATA` and `TERMINAL_EXIT`.
5. `pnpm blt` (build to verify types compile).

### Phase 2: Server — Terminal Session Registry + tRPC Router

**Files**: `web/src/server/trpc/context.ts`, `web/src/server/trpc/routers/terminal.ts`, `web/src/server/trpc/routers/terminal.test.ts`, `web/src/server/trpc/root.ts`

**TDD Steps:**
1. Add `terminalSessions` map to `AppState` interface and `getAppState()`.
2. Write tests for `terminal.list` — returns active sessions for a workspace.
3. Write tests for `terminal.create` — validates daemon connected, registers session, returns sessionId.
4. Write tests for `terminal.kill` — removes session from registry.
5. Implement the router. `terminal.create` generates a UUID sessionId, stores session metadata, and sends `TERMINAL_SPAWN_REQUEST` via the daemon WebSocket. `terminal.kill` sends `TERMINAL_KILL` and removes from registry.
6. Register in `root.ts`.
7. `pnpm blt`.

### Phase 3: Server — WebSocket Terminal Relay

**Files**: `web/src/server/ws/server.ts`, `web/server.ts`

**TDD Steps:**
1. Add a second WebSocket endpoint `/ws/terminal` for browser connections. Modify `server.ts` upgrade handler to route `/ws/terminal` to a new WebSocketServer.
2. Handle `TERMINAL_DATA` from daemon: look up `sessionId`, forward to the corresponding browser WebSocket.
3. Handle `TERMINAL_DATA` from browser: look up `sessionId`, forward to daemon.
4. Handle `TERMINAL_EXIT` from daemon: mark session as exited, forward to browser.
5. Track browser WebSocket connections in AppState (map of sessionId -> browser ws). On browser disconnect, clean up.
6. `pnpm blt`.

### Phase 4: Client — Terminal Process Manager

**Files**: `client/src/terminal/manager.ts`, `client/src/terminal/manager.test.ts`, `client/src/terminal/types.ts`, `client/src/index.ts`, `client/src/ws/client.ts`

**TDD Steps:**
1. Write tests for `TerminalManager`: spawn process (mock `node-pty`), receive data relay, resize, kill with timeout, cleanup on daemon shutdown.
2. Implement `TerminalManager` class:
   - `spawn(sessionId, workingDir, cols, rows, agentName?)` — creates pty process.
   - `write(sessionId, data)` — writes decoded base64 to pty stdin.
   - `resize(sessionId, cols, rows)` — resizes pty.
   - `kill(sessionId)` — SIGTERM, 3s timeout, SIGKILL.
   - `killAll()` — kills all active processes.
3. Wire into `WsClient`: handle `TERMINAL_SPAWN_REQUEST`, `TERMINAL_DATA` (from server), `TERMINAL_RESIZE`, `TERMINAL_KILL` messages.
4. Wire into `client/src/index.ts`: create `TerminalManager`, pass to `WsClient`, call `killAll()` on shutdown.
5. Add `node-pty` dependency to client package.
6. `pnpm blt`.

### Phase 5: UI — shadcn Resizable Component

**Files**: `web/src/components/ui/resizable.tsx`

1. Install shadcn resizable: `npx shadcn@latest add resizable`.
2. `pnpm blt`.

### Phase 6: UI — Terminal Types + Provider

**Files**: `web/src/components/terminal/types.ts`, `web/src/components/terminal/terminal-provider.tsx`

1. Define types: `TerminalScope` (scopeType, scopeLabel, workingDir, agentName), `TerminalTab` (sessionId, scope, status).
2. Build `TerminalProvider`:
   - React context holding: `tabs` array, `activeTabId`, `collapsed` boolean.
   - Establishes WebSocket connection to `/ws/terminal` on mount.
   - Routes incoming `TERMINAL_DATA` and `TERMINAL_EXIT` to registered xterm callbacks by sessionId.
   - Exposes: `openTerminal(scope)` (calls tRPC `terminal.create`, adds tab), `closeTerminal(sessionId)` (calls `terminal.kill`, removes tab), `setActiveTab(sessionId)`, `togglePanel()`.
3. `pnpm blt`.

### Phase 7: UI — Terminal Tab (xterm.js)

**Files**: `web/src/components/terminal/terminal-tab.tsx`

1. Install xterm packages: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`.
2. Build `TerminalTab` component:
   - Creates an `xterm.Terminal` instance on mount.
   - Attaches `FitAddon` and calls `fit()` on mount and resize.
   - Attaches `WebLinksAddon` for clickable links.
   - Registers `terminal.onData` callback that sends data to the provider's WebSocket.
   - Exposes a method to write incoming data from the provider.
   - Loaded via `next/dynamic` with `ssr: false`.
3. `pnpm blt`.

### Phase 8: UI — Terminal Panel + Tab Bar

**Files**: `web/src/components/terminal/terminal-panel.tsx`, `web/src/components/terminal/terminal-tab-bar.tsx`

1. Build `TerminalTabBar`:
   - Maps provider's `tabs` array to tab buttons.
   - Each tab shows scope icon + label + close button.
   - "+" button calls `openTerminal` with current scope.
   - Active tab highlighted.
2. Build `TerminalPanel`:
   - Tab bar at top, active terminal view below.
   - Empty state when no tabs.
   - Collapse toggle button in header.
3. `pnpm blt`.

### Phase 9: UI — Terminal Shell (Layout Wrapper)

**Files**: `web/src/components/terminal/terminal-shell.tsx`, `web/src/components/terminal/use-terminal-scope.ts`

1. Build `TerminalShell`:
   - Uses shadcn `ResizablePanelGroup` with `direction="horizontal"`.
   - Left `ResizablePanel` (defaultSize 60, minSize 30) renders `children`.
   - `ResizableHandle` with grip indicator.
   - Right `ResizablePanel` (defaultSize 40, minSize 15, collapsible) renders `TerminalPanel`.
   - When provider's `collapsed` is true, right panel collapses.
2. Build `useTerminalScope()` hook:
   - Reads `usePathname()` + `useParams()`.
   - Derives scope from route (spec, project, workspace, docs).
   - Queries workspace data via tRPC to resolve `workingDir`.
3. `pnpm blt`.

### Phase 10: UI — Wire Into Layouts

**Files**: `web/src/app/layout.tsx`, `web/src/app/w/[workspace]/layout.tsx`

1. Wrap root layout children with `TerminalProvider` (only renders the provider context, no visual).
2. Wrap workspace layout children with `TerminalShell` (provides the resizable two-panel layout).
3. Register keyboard shortcut (Ctrl+` / Cmd+`) in the provider to toggle collapse.
4. `pnpm blt`.

### Phase 11: Skills — Update for Terminal Auto-Start

**Files**: `.claude/skills/engy-spec-assistant.md` (no changes needed — skills are already markdown files that reference MCP tools; terminal auto-start is handled by the UI scope derivation, not the skill files themselves)

This phase is a no-op. The skill files from M4 are already correct. The terminal panel's scope derivation (FR #19) passes the `agentName` to `terminal.create`, and the daemon spawns the CLI with that skill context. No skill file changes needed.

### Phase 12: Tooling Polish

1. Run `pnpm blt` — fix any knip (unused exports), jscpd (copy-paste), or coverage issues.
2. Ensure all new routers have 90%+ test coverage.
3. Verify no TypeScript errors across the monorepo.
4. `pnpm blt` final pass.

---

## Key Decisions

1. **Separate browser WebSocket endpoint**: Terminal I/O uses `/ws/terminal` (new), distinct from the daemon's `/ws`. This prevents the browser from seeing daemon-only messages (path validation, file changes, workspace sync) and simplifies routing. The server acts as a relay between the two WebSocket connections.

2. **Base64 encoding for terminal data**: PTY output is binary data that may contain escape sequences. Base64 encoding ensures safe transport over JSON WebSocket messages without corruption.

3. **xterm.js packages**: Using `@xterm/xterm` (v5+), `@xterm/addon-fit`, `@xterm/addon-web-links`. These are the official xterm.js v5 packages under the `@xterm` scope.

4. **node-pty for process spawning**: The client daemon uses `node-pty` to create pseudo-terminals. This provides proper terminal emulation (escape codes, signals, resize) rather than plain `child_process.spawn`. node-pty is a native module, so the client's build step may need attention.

5. **In-memory session registry**: Terminal sessions are stored in AppState (in-memory), not in SQLite. Sessions are ephemeral — they don't need to survive server restarts. This avoids schema migrations and keeps the implementation simple.

6. **No auto-open terminals**: When navigating to a scoped page, the UI does NOT automatically open a terminal. It provides the scope context so the "+" button opens the right kind of terminal, but the user must explicitly request it. This avoids unexpected process spawning.

7. **Single multiplexed WebSocket**: The browser uses one WebSocket connection for all terminal tabs. Messages are routed by `sessionId`. This avoids per-tab WebSocket overhead and simplifies the connection lifecycle.

8. **Terminal tab persistence via DOM hiding**: When switching between terminal tabs, inactive xterm instances are hidden via CSS (`display: none`), not unmounted. This preserves the terminal's scroll buffer and state without re-rendering.

9. **No vertical/horizontal splits in M5 initial delivery**: The milestone spec mentions splits, but splits add significant UI complexity (recursive split containers, focus management, proportional resizing). The initial delivery supports tab-based multi-terminal. Splits can be added as a fast follow if needed — the architecture supports it since each terminal is an independent component.

10. **Resizable panel with shadcn**: Using shadcn's resizable component (based on `react-resizable-panels`) for the main/terminal split. This provides the drag handle, min/max sizes, and collapse support out of the box.

---

## Out of Scope

| Feature | Milestone |
|---------|-----------|
| Diff viewer | M6 |
| Feedback routing from diffs to terminal | M6 |
| Worktree management | M7 |
| Knowledge/memory layer | M8 |
| Activity feed | M9 |
| Notifications | M9 |
| Global search | M8/M9 |
| Agent sessions / async execution | M10 |
| Dev containers | M11 |
| PR monitoring | M12 |
| Vertical/horizontal terminal splits | Fast follow (architecture supports it) |
| Terminal session persistence across server restarts | Future (SQLite storage) |
| Diffs tab terminal scope | M6 (no diff functionality yet) |

---

## Dependencies to Add

| Package | Target | Purpose |
|---------|--------|---------|
| `node-pty` | client | PTY process spawning for terminal emulation |
| `@xterm/xterm` | web | Terminal emulator for browser |
| `@xterm/addon-fit` | web | Auto-resize terminal to container |
| `@xterm/addon-web-links` | web | Clickable URLs in terminal output |
| `shadcn/resizable` | web | Resizable panel layout (via `npx shadcn@latest add resizable`) |

---

## Verification

1. `pnpm blt` passes (build + lint + test)
2. Navigate to workspace specs page -> terminal panel visible on right side, resizable
3. Click "+" to open a terminal -> terminal connects and shows Claude Code prompt
4. Type in terminal -> I/O relays correctly, output displays
5. Open second terminal tab -> both tabs work, can switch between them
6. Close a terminal tab -> process is killed, tab removed
7. Collapse terminal panel via keyboard shortcut -> panel hides
8. Expand terminal panel -> restored to previous width
9. Navigate from specs to tasks -> existing terminal tab persists
10. Open terminal on project page -> scope is "project: {slug}" with project-assistant
11. Resize terminal panel by dragging handle -> xterm re-fits
12. Terminal process exits -> tab shows "exited" state
13. MCP tools and skills still work from the terminal within the panel

---

## Plan Review

**Reviewer**: Automated cross-reference check against `docs/projects/initial/milestones.md` M5 section.

### Completeness Check

All M5 milestone spec requirements are covered:

| Milestone Spec Requirement | Plan Coverage |
|---|---|
| Terminal panel (right side of layout) with xterm.js | FR #15, #18, Phase 5-9 |
| Tab-based multiple terminals simultaneously | FR #14, #17, Phase 6, 8 |
| Tab metadata labels showing scope | FR #17, #19, Phase 8-9 |
| Vertical/horizontal splits | Deferred — Key Decision #9, noted in Out of Scope |
| Drag-resizable left edge | FR #15, Phase 9 (shadcn ResizablePanelGroup) |
| Collapsible (keyboard shortcut + toggle button) | FR #20, Phase 10 |
| Context-scoped: Spec page -> spec-assistant | FR #19, scope derivation |
| Context-scoped: Project page -> project-assistant | FR #19, scope derivation |
| Context-scoped: Default project / workspace Tasks -> workspace-assistant | FR #19, scope derivation |
| Context-scoped: Diffs tab -> worktree, no agent | Deferred to M6 (no diffs tab functionality yet) |
| Context-scoped: Docs page -> sysdoc-assistant | FR #19, scope derivation |
| Scope persistence across navigation | FR #22, Phase 6 (provider in root layout) |
| New terminal matches current page scope | FR #17, #19, Phase 8-9 |
| Client: CLI process management (spawn, kill, resize) | FR #9, #11, #13, Phase 4 |
| Client: WebSocket bridge xterm <-> CLI process | FR #2, #10, Phase 3-4 |
| Client: Context injection (workingDir, agentName, scope) | FR #1, #9, Phase 1, 4 |
| Client: Terminal session persistence across navigation | FR #22, Phase 6 |
| Server: Terminal session registry | FR #5-6, Phase 2 |
| Server: WebSocket relay for terminal I/O | FR #2, Phase 3 |
| Skills: All shipped skills auto-start in terminal | FR #19, Phase 11 (no-op, scope derivation handles it) |

### Deferred Items

1. **Vertical/horizontal splits**: Deferred with clear rationale (Key Decision #9). The tab-based architecture supports future split addition. This is a reasonable scope cut — splits add significant UI complexity (recursive containers, focus management) without blocking the core terminal experience.

2. **Diffs tab terminal scope**: Deferred to M6 when the diff viewer ships. The scope derivation hook can be extended trivially.

### Out-of-Scope Validation

No out-of-scope features were included. Diff viewer (M6), worktree management (M7), knowledge layer (M8), async agents (M10), and PR monitoring (M12) are all explicitly excluded.

### Phase Ordering

Phases are logically ordered: protocol first (Phase 1), then server (Phases 2-3), then client (Phase 4), then UI bottom-up (Phases 5-10), skills (Phase 11), polish last (Phase 12). Each phase is independently `pnpm blt`-green. No phase depends on a later phase.

Dependencies are correct:
- Phase 1 (protocol types) unblocks all subsequent phases
- Phase 2 (tRPC router) needs types from Phase 1
- Phase 3 (WS relay) needs types from Phase 1 and session registry from Phase 2
- Phase 4 (client manager) needs types from Phase 1
- Phases 5-10 (UI) need the server and client infrastructure from Phases 1-4
- Phase 10 (layout wiring) needs all UI components from Phases 6-9

### File Map Coverage

All functional requirements have corresponding files in the file map. New files are clearly marked (NEW) vs modified (MODIFY). Test files are included for all new server and client code.

### Issues Found

1. **Minor**: The plan mentions `BrowserToServerMessage` union type in Phase 1 but the protocol file currently only has `WsMessage`, `ClientToServerMessage`, and `ServerToClientMessage`. The implementer should add `BrowserToServerMessage` or extend the existing types clearly to distinguish browser vs daemon message directions.

2. **Architecture note**: The `/ws/terminal` endpoint creates a second WebSocketServer. The implementer must ensure the upgrade handler in `server.ts` correctly routes to the right WSS based on pathname.

Both items are implementation details, not plan deficiencies.

**LGTM.**
