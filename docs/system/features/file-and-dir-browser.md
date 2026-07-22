---
description: Daemon-proxied user-repo file access and server-local engy-dir file operations.
order: 12
---

# File and Directory Browser

Engy exposes two distinct surfaces for file operations. They share no implementation but are unified in the browser UI.

**Daemon-proxied surface** (`file` router — `web/src/server/trpc/routers/file.ts`) handles everything that touches a user-owned repository. The server never calls `fs` directly on user repos; every operation is forwarded to the client daemon over the `/ws` WebSocket channel using the pending-map dispatch pattern (`dispatchDirList`, `dispatchFileRead`, `dispatchFileWrite`, `dispatchCreateDir`, `dispatchFsDelete`, `dispatchFsRename`, `dispatchValidation`, `dispatchFileSearch` in `web/src/server/ws/server.ts`). The daemon processes the request locally and returns a response that resolves the pending promise. If no daemon is connected at call time the dispatcher rejects immediately with `'No daemon connected'`, which the router surfaces as `PRECONDITION_FAILED`.

**Server-local surface** (`dir` router — `web/src/server/trpc/routers/dir.ts`) handles the engy-owned directories (`system/`, `docs/`, `memory/`, `projects/`, `specs/`) directly via `node:fs`. It enforces two security invariants on every path parameter: absolute paths are rejected with `BAD_REQUEST`; `..`-escaping paths are rejected with `BAD_REQUEST "Path traversal detected"`. Both checks live in the `validatePath` helper at `dir.ts:48`. The `file` router applies a parallel guard (`resolveContainedDirPath` at `file.ts:21`) to the `createDir` mutation; traversal detection on daemon-side delete and rename is delegated to the daemon itself.

**File-type gating** on the server-local surface is handled by `isTextPath` and `isImagePath` from `web/src/lib/file-types.ts`. Text reads and writes accept any extension in the `TEXT_EXTENSIONS` set plus extensionless files; image reads accept the eight MIME types in `IMAGE_MIME`. Binary files that match neither classification are rejected.

**Search** against user repos (`dir.searchRepoFiles` / `dispatchFileSearch`) uses a `SEARCH_FILES_REQUEST` message with a 10-second timeout (`FILE_SEARCH_TIMEOUT_MS = 10_000` in `ws/server.ts`). The daemon fulfils the search using glob and `git ls-files`.

**Live change notifications** flow from the daemon's `SpecWatcher` (chokidar, polling at 1-second intervals by default to avoid macOS libuv/PTY interference) through a three-stage pipeline. The watcher (`client/src/watcher.ts`) monitors each workspace's entire `docsDir` (or `ENGY_DIR/<slug>`), skipping hidden directories and `node_modules` to mirror what the docs tree displays. On `add`, `change`, or `unlink` events it sends a `FILE_CHANGE` WebSocket message to the server. `adddir`/`unlinkdir` events are silently dropped by `mapEventType`. The server's `handleFileChange` function (`ws/server.ts:314`) appends the event to a per-workspace ring buffer capped at `MAX_EVENTS_PER_WORKSPACE = 100` (oldest events evicted), triggers `handleSpecFileChange` when the path contains `/projects/`, then calls `broadcastFileChange` from `web/src/server/ws/broadcast.ts`. `broadcastFileChange` serialises a `FILE_CHANGE` event and sends it to every WebSocket in `state.fileChangeListeners` whose `readyState === OPEN`. Browser clients connect to `/ws/events` (`web/src/server/ws/events-server.ts`), which registers and deregisters sockets in `state.fileChangeListeners` on connection and close.

**Reindex on write/delete** — the `dir.write` and `dir.deleteFile` procedures call `reindexCollection` (`dir.ts:38`) after a successful operation when a `workspaceSlug` is supplied. `detectCollection` maps the `dirPath` to one of `system | docs | projects | memory`; if matched, `updateAndEmbed` is called best-effort — failures are logged and never surfaced to the caller.

**Directory listing variants** — the `dir.list` procedure returns only `.md` files and subdirectories that contain at least one `.md` file within `MAX_DEPTH = 5` levels, skipping hidden (`.`-prefixed) entries. `dir.listFiles` uses `collectMarkdownFilesAndDirs` to return all file types with `{ path, mtime }` metadata, also skipping hidden entries and silently ignoring unreadable subdirs. `dir.home` returns `os.homedir()` directly; `file.home` requires a connected daemon whose `daemonHomeDir` has been set on registration.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-FILES-010 | IF no daemon is connected, THEN the system SHALL reject calls to `file.home` and `file.validatePaths` with a `PRECONDITION_FAILED` error; other `file` router calls (`listDir`, `read`, `write`, `createDir`, `deleteEntry`, `renameEntry`) delegate to `dispatchDaemonOp` which rejects with a raw `Error('No daemon connected')` (not wrapped as `PRECONDITION_FAILED`). |
| FR-FILES-020 | WHEN `file.home` is called with a connected daemon whose `daemonHomeDir` is null, the system SHALL throw `PRECONDITION_FAILED` indicating the daemon did not report a home directory. |
| FR-FILES-030 | WHEN `file.home` is called with a connected daemon whose `daemonHomeDir` is set, the system SHALL return `{ path }` containing that home directory path. |
| FR-FILES-040 | WHEN `file.validatePaths` is called, the system SHALL send a `VALIDATE_PATHS_REQUEST` to the daemon and return `{ results }` containing a per-path `{ path, exists }` map on success. |
| FR-FILES-050 | WHEN `file.listDir` is called and the daemon reports ENOENT or "not found", the system SHALL throw `NOT_FOUND`. |
| FR-FILES-060 | IF `file.createDir` receives an absolute `relPath`, THEN the system SHALL throw `BAD_REQUEST` "Absolute paths not allowed" before dispatching to the daemon. |
| FR-FILES-070 | IF `file.createDir` receives a `..`-escaping `relPath`, THEN the system SHALL throw `BAD_REQUEST` "Path traversal detected" before dispatching to the daemon. |
| FR-FILES-080 | WHEN `file.createDir` dispatches to the daemon and the daemon returns a failure result, the system SHALL throw `BAD_REQUEST` with the daemon's error message. |
| FR-FILES-090 | WHEN `dir.list` is called on a valid directory, the system SHALL return only `.md` files and subdirectories containing at least one `.md` file within five levels, excluding hidden entries, with both lists sorted alphabetically. |
| FR-FILES-100 | IF `dir.list`, `dir.listFiles`, or `dir.read` is called with a path that does not exist, THEN the system SHALL throw `NOT_FOUND`. |
| FR-FILES-110 | IF `dir.read` or `dir.write` is called with a file path whose extension is not in the text-readable set (as determined by `isTextPath`), THEN the system SHALL throw `BAD_REQUEST`. |
| FR-FILES-120 | IF `dir.read` is called on a file whose size exceeds 2 000 000 bytes, THEN the system SHALL throw `BAD_REQUEST` indicating the file is too large to preview. |
| FR-FILES-130 | WHEN `dir.read` is called on a valid text file within the directory bounds, the system SHALL return `{ content }` as a UTF-8 string. |
| FR-FILES-140 | IF `dir.readImage` is called with a path whose extension is not a supported image type (as determined by `isImagePath`), THEN the system SHALL throw `BAD_REQUEST`. |
| FR-FILES-150 | WHEN `dir.readImage` is called on a valid image file, the system SHALL return `{ dataUri }` as a base64 data URI. |
| FR-FILES-160 | WHEN `dir.write` succeeds and a `workspaceSlug` is supplied, the system SHALL trigger a best-effort reindex of the matching knowledge collection (`system`, `docs`, `projects`, or `memory`) without failing the write on reindex error. |
| FR-FILES-170 | IF `dir.renameFile` or `dir.renameDir` targets a path that already exists, THEN the system SHALL throw `CONFLICT`. |
| FR-FILES-180 | WHEN `dir.searchRepoFiles` is called with a connected daemon, the system SHALL send a `SEARCH_FILES_REQUEST` and resolve with `{ results }` from the daemon; IF no response arrives within 10 000 ms, THEN the system SHALL reject with a timeout error. |
| FR-FILES-190 | WHEN the daemon's `SpecWatcher` detects an `add`, `change`, or `unlink` event anywhere under a workspace's docs directory (excluding hidden directories and `node_modules`), the system SHALL send a `FILE_CHANGE` WebSocket message containing `{ workspaceSlug, path, eventType }` to the server. |
| FR-FILES-200 | WHEN the server receives a `FILE_CHANGE` message from the daemon, the system SHALL broadcast a `FILE_CHANGE` event to all open `/ws/events` browser connections so the file tree refreshes. (Ring-buffer mechanics — cap 100, evict oldest — are specified in the websocket-daemon-protocol area as FR-WS-090.) |
| FR-FILES-210 | IF `file.readImage` is called with a path whose extension is not a supported image type (as determined by `imageMimeType`), THEN the system SHALL throw `BAD_REQUEST` before contacting the daemon. |
| FR-FILES-220 | IF `file.readImage` is called for a supported image while no daemon is connected, THEN the system SHALL throw `PRECONDITION_FAILED`. |
| FR-FILES-230 | WHEN `file.readImage` is called for a supported image with a connected daemon, the system SHALL dispatch a `FILE_READ_IMAGE_REQUEST` (reading from the working tree or a git `ref`, via `worktreePath`/`coderWorkspace` when supplied) and return `{ dataUri }` as a `data:<mime>;base64,<bytes>` URI built from the daemon's base64 payload. |

## Sources

No prior knowledge found.
