---
title: Open Directory
status: complete
---

# Plan: M3 — Open Directory

## Overview

Add a lightweight "quick-open" mode accessible from the Home page. The user picks any directory on the server filesystem, browses its markdown files in a file tree, and edits them in the existing BlockNote editor. No workspace, no project, no spec overhead. Recent directories are cached in `localStorage` for quick re-access. The terminal panel and inline comments are explicitly out of scope for this milestone.

---

## Codebase Context

- **Two-panel pattern**: established in `web/src/app/w/[workspace]/specs/page.tsx` — resizable sidebar (SpecTree) + content editor (DynamicDocumentEditor). Reuse this layout.
- **BlockNote editor**: `web/src/components/editor/document-editor.tsx` + `web/src/components/editor/dynamic-document-editor.tsx`. Accepts `initialContent` (markdown string), `onSave` callback, and optional `threadStore`. Works without comments via `InMemoryThreadStore`.
- **Path safety**: `validatePath(base, target)` in `web/src/server/spec/service.ts` — uses `path.resolve` + `path.relative` to block traversal. Same pattern used here.
- **tRPC router registration**: `web/src/server/trpc/root.ts` — add new `dir` router here.
- **Home page**: `web/src/app/page.tsx` — client component, shows workspace cards + CreateWorkspaceDialog. Add "Open Directory" button and recent dirs list alongside.
- **AppHeader breadcrumbs**: `web/src/components/app-header.tsx` — reads pathname, auto-generates breadcrumbs. No changes needed; `/open` will show "engy / open".
- **Slug/dialog pattern**: `web/src/components/workspaces/create-workspace-dialog.tsx` — reference for dialog + form pattern.

---

## Affected Components

| File | Change |
|------|--------|
| `web/src/server/db/schema.ts` | **Modify** — make `workspaceId` nullable on `commentThreads` |
| `web/src/server/db/migrations/` | **Create** — migration to drop NOT NULL on `commentThreads.workspaceId` |
| `web/src/server/trpc/routers/comment.ts` | **Modify** — handle null `workspaceId`: scope threads by `documentPath` alone when workspace is absent |
| `web/src/components/editor/thread-store.ts` | **Modify** — `EngyThreadStore` to work without a workspace slug (pass `undefined`; queries by `documentPath` only) |
| `web/src/server/trpc/routers/dir.ts` | **Create** — new tRPC router for directory ops |
| `web/src/server/trpc/root.ts` | **Modify** — register `dir` router in `appRouter` |
| `web/src/app/open/page.tsx` | **Create** — Open Directory page (two-panel layout) |
| `web/src/components/open-dir/open-dir-tree.tsx` | **Create** — file tree for arbitrary directories (markdown-only) |
| `web/src/components/open-dir/open-dir-dialog.tsx` | **Create** — path input dialog triggered from Home |
| `web/src/hooks/use-recent-dirs.ts` | **Create** — localStorage hook for recent directories |
| `web/src/app/page.tsx` | **Modify** — add "Open Directory" button + recent dirs list |
| `web/src/server/trpc/routers/dir.test.ts` | **Create** — integration tests for dir router |
| `web/src/server/trpc/routers/comment.test.ts` | **Modify** — add tests for workspace-less comment threads |

---

## Functional Requirements

**Home Page**

1. The system shall display an "Open Directory" button on the Home page alongside the existing "New Workspace" action. *(user request)*
2. When the user clicks "Open Directory", the system shall present a dialog with a text input for entering an absolute directory path. *(user request)*
3. When the user submits a valid path, the system shall navigate to `/open?path={encodedPath}`. *(inferred: URL-driven state pattern from M2)*
4. The system shall display up to 10 recently opened directories on the Home page below the workspace list. *(user request)*
5. Clicking a recent directory shall navigate directly to `/open?path={encodedPath}` without the dialog. *(user request)*
6. Recent directories shall be stored in `localStorage` under the key `engy:recent-dirs` as a JSON array of strings. *(elicited)*

**Open Directory Page**

7. The system shall display a two-panel layout: collapsible file tree (left, 180–384px, draggable) and content editor (right). *(user request, inferred: specs page pattern)*
8. The file tree shall display only `.md` files and subdirectories that contain `.md` files, recursively. *(elicited)*
9. When the user selects a file in the tree, the system shall load its content and display it in the BlockNote editor. *(user request)*
10. The system shall autosave edits back to the file on the server filesystem after a 1500ms debounce. *(inferred: existing editor autosave pattern)*
11. The system shall show the selected file's path relative to the open directory above the editor. *(inferred: specs page shows file path indicator)*
12. The system shall add the opened directory to recent dirs on mount. *(inferred: UX — directory is added when visited)*

**Comments in Open Directory**

13. The system shall support inline comments on Open Directory markdown files using the existing `EngyThreadStore`, with `workspaceId` omitted (null). *(elicited)*
14. The `commentThreads` table shall allow `workspaceId` to be null via a schema migration. *(elicited)*
15. `comment.listThreads`, `comment.createThread`, and all other comment procedures shall accept an optional `workspaceSlug` — when absent, threads are scoped by `documentPath` alone. *(elicited)*
16. `EngyThreadStore` shall accept an optional `workspaceSlug`; when undefined, it omits the workspace filter from all tRPC calls. The `documentPath` for Open Directory files is the absolute file path (e.g., `/Users/aleks/notes/readme.md`). *(elicited)*

**Server (dir router)**

17. `dir.list(dirPath)`: The system shall return `{ dirs: string[], files: string[] }` (dirs = subdirs containing ≥1 `.md` file; files = `.md` files directly in `dirPath`), validating that `dirPath` exists and is a directory. *(user request)*
18. `dir.read(dirPath, filePath)`: The system shall return the UTF-8 string content of the file at `filePath` relative to `dirPath`, preventing path traversal. *(user request)*
19. `dir.write(dirPath, filePath, content)`: The system shall write `content` to `filePath` relative to `dirPath`, preventing path traversal. *(user request)*
20. All `dir` router procedures shall throw a descriptive tRPC error if the path does not exist, is not a directory/file, or if path traversal is detected. *(inferred: fail-fast pattern from spec service)*

---

## Non-Functional Requirements

- Path traversal prevention: all server file ops must validate with `path.resolve`+`path.relative` (same as `validatePath()` in spec service).
- Recent dirs cap: max 10 entries in localStorage, deduplicated on insert, newest first.
- File tree recursion: bounded depth to prevent runaway on huge directory trees (max depth: 5).

---

## Workflow

1. User is on the Home page (`/`).
2. User clicks **"Open Directory"** button.
3. Dialog appears with a text input placeholder "Enter absolute path, e.g. /Users/you/docs".
4. User types a path (e.g., `/Users/aleks/notes`) and clicks **"Open"**.
5. Client navigates to `/open?path=%2FUsers%2Faleks%2Fnotes`.
6. Page loads, calls `dir.list` → displays file tree on the left.
7. User clicks a `.md` file in the tree.
8. Page calls `dir.read` → file content loaded into BlockNote editor.
9. User edits content; autosave fires after 1500ms idle → calls `dir.write`.
10. User navigates back to Home → sees `/Users/aleks/notes` in recent directories.
11. User clicks it → skips dialog, goes directly to `/open?path=...`.

**Error branches:**
- `dir.list` fails (path doesn't exist / not a directory): show error card inline on the open page.
- `dir.read` fails: show error in editor area.
- `dir.write` fails: surface inline error near editor (toast or inline text).

---

## Out of Scope

- Terminal panel (explicitly skipped)
- Non-markdown file editing or viewing (hidden from tree)
- Native OS directory picker dialog
- Server-side storage for recent directories
- Client daemon path validation for Open Directory paths
- Search within the opened directory
- Creating new files from within the Open Directory view
- Deleting files

---

## Implementation Sequence

1. **Schema migration** — Make `workspaceId` nullable on `commentThreads`. Generate migration via Drizzle Kit.
2. **`comment.ts` router** — Update `listThreads` + `createThread` (and other procedures) to accept optional `workspaceSlug`; filter by `documentPath` only when workspace is null.
3. **`comment.test.ts`** — Add tests for workspace-less thread creation and listing.
4. **`thread-store.ts`** — Update `EngyThreadStore` constructor to accept optional `workspaceSlug`; omit workspace filter in tRPC calls when undefined.
5. **`web/src/server/trpc/routers/dir.ts`** — `list`, `read`, `write` procedures. Reuse `validatePath` pattern. Return typed objects.
6. **`web/src/server/trpc/root.ts`** — Register `dir` router.
7. **`web/src/server/trpc/routers/dir.test.ts`** — Integration tests: list returns only .md files + subdirs with .md; read/write round-trip; path traversal rejected; nonexistent path errors.
8. **`web/src/hooks/use-recent-dirs.ts`** — `useRecentDirs()` hook: `{ dirs, addDir, removeDir }`. localStorage-backed, dedup, max 10, newest-first.
9. **`web/src/components/open-dir/open-dir-dialog.tsx`** — Path input dialog. Validates non-empty string on submit. Calls `addDir` + `router.push`.
10. **`web/src/app/page.tsx`** — Add "Open Directory" button (triggers dialog). Below workspace list, show recent dirs as compact links with an "×" remove button. Use `useRecentDirs()`.
11. **`web/src/components/open-dir/open-dir-tree.tsx`** — File tree from `dir.list` result. Recursive (up to depth 5). Markdown-only. Collapsible directories. Click → notify parent with selected file path. Follow SpecTree's icon/selection patterns using `TreeView` component.
12. **`web/src/app/open/page.tsx`** — Two-panel layout (same structure as specs page: resizable sidebar + editor). Reads `?path=` param. Calls `dir.list` for tree. On file select, calls `dir.read`. Autosave calls `dir.write`. Shows file path indicator. Adds dir to recent dirs on mount. Passes `EngyThreadStore(undefined, absoluteFilePath)` to editor for comments.

---

## Verification

```bash
# Run tests
cd web && pnpm vitest run src/server/trpc/routers/dir.test.ts

# Full gate
pnpm blt
```

**Manual walkthrough:**
1. Home page → "Open Directory" → enter `~/.engy` or any local docs dir → editor opens with file tree
2. Select a `.md` file → edit content → wait 1.5s → verify file changed on disk (`cat` the file)
3. Navigate back to Home → recent dir appears
4. Click recent dir → navigates without dialog
5. Enter non-existent path → error card shown on `/open` page
6. Try path like `../../etc` → server rejects with traversal error
