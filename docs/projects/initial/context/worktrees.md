# Plan: Git Worktree Support for Project Creation (v2)

## Context

Projects should optionally get git worktrees so Claude agents work in isolation per project. A workspace has multiple repos — each repo needs its own worktree per project, so all code changes go to the right branch. When `docsDir` is inside a repo (e.g., `docsDir=/Users/aleks/dev/engy/docs` inside repo `/Users/aleks/dev/engy`), project spec files must resolve through the worktree too.

## Key Design Decisions

1. **One worktree per repo per project** — stored as `worktreePaths: Record<string, string>` (repo → worktree path) on the projects table

2. **No workspace-level&#x20;**`worktreeDir` — each repo's worktrees go under `{repo}/.claude/worktrees/{project-slug}` (consistent with Claude Code convention, YAGNI on configurability)

3. `effectiveWorkspace()`**&#x20;helper** — when docsDir is inside a repo with a worktree, rewrites docsDir to the worktree equivalent. All existing `project/service.ts` functions work unchanged since they call `getWorkspaceDir(workspace)` which reads `docsDir`

4. `effectiveRepos()`**&#x20;helper** — replaces each repo with its worktree path if one exists, for terminal/quick action dirs

5. **Worktree creation goes through client daemon** via WebSocket (server never touches repos)

6. **Fail entire creation** if any worktree add fails — compensating action deletes DB row + any already-created worktrees

7. **Branch name = project slug**

## Changes

### 1. DB Schema + Migration

`web/src/server/db/schema.ts` — add to `projects` table:

```text
worktreePaths: text('worktree_paths', { mode: 'json' }).$type<Record<string, string>>()
```

Maps repo absolute path → worktree absolute path. Null when no worktrees.

Generate migration with `pnpm drizzle-kit generate`.

### 2. WebSocket Protocol

`common/src/ws/protocol.ts` — add message types:

* `GIT_WORKTREE_ADD_REQUEST` — `{ requestId, repoDir, worktreePath, branch }`

* `GIT_WORKTREE_ADD_RESPONSE` — `{ requestId, worktreePath }` or `{ requestId, error }`

Add to `ClientToServerMessage` and `ServerToClientMessage` unions. Export from `common/src/index.ts`.

### 3. Client Daemon

`client/src/git/index.ts` — add:

```typescript
export async function addWorktree(repoDir: string, worktreePath: string, branch: string): Promise<string> {
  await execFileAsync('git', ['-C', repoDir, 'worktree', 'add', '-b', branch, worktreePath], {
    maxBuffer: EXEC_MAX_BUFFER,
  });
  return worktreePath;
}
```

`client/src/ws/client.ts` — add `GIT_WORKTREE_ADD_REQUEST` case in `handleMessage` switch + handler method (same pattern as `handleGitStatusRequest` etc.).

### 4. Server WebSocket Dispatch

`web/src/server/trpc/context.ts` — add to `AppState`:

```text
pendingGitWorktreeAdd: Map<string, { resolve: (result: GitWorktreeAddResult) => void; reject: (reason: Error) => void }>
```

With `GitWorktreeAddResult = { worktreePath: string }`.

`web/src/server/ws/server.ts`:

* Add `GIT_WORKTREE_ADD_RESPONSE` case in `handleMessage` using `resolveGitResponse`

* Add `dispatchGitWorktreeAdd(repoDir, worktreePath, branch, state)` using `dispatchGitOp`

* Add `pendingGitWorktreeAdd` to `rejectAllPending`

### 5. Path Resolution Helpers

`web/src/server/trpc/routers/project.ts` — add two helpers:

```typescript
/** When docsDir is inside a repo with a worktree, rewrite docsDir to the worktree equivalent */
function effectiveWorkspace(
  workspace: { slug: string; docsDir: string | null; repos: unknown },
  worktreePaths: Record<string, string> | null,
): { slug: string; docsDir: string | null } {
  if (!worktreePaths || !workspace.docsDir) return workspace;
  const repos = (workspace.repos as string[]) ?? [];
  for (let i = 0; i < repos.length; i++) {
    const rel = path.relative(repos[i], workspace.docsDir);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && worktreePaths[repos[i]]) {
      return { slug: workspace.slug, docsDir: path.join(worktreePaths[repos[i]], rel) };
    }
  }
  return workspace;
}
```

```typescript
/** Replace repos with their worktree paths where available */
function effectiveRepos(repos: string[], worktreePaths: Record<string, string> | null): string[] {
  if (!worktreePaths) return repos;
  return repos.map(r => worktreePaths[r] ?? r);
}
```

### 6. Project Router Changes

`web/src/server/trpc/routers/project.ts`:

**Update&#x20;**`project.create`**:**

* Add `createWorktree: z.boolean().optional().default(false)` to input

* Make mutation async (needs `ctx` for AppState)

* When `createWorktree` is true and workspace has repos:

  * For each repo: compute worktree path (`{repo}/.claude/worktrees/{slug}`), call `dispatchGitWorktreeAdd`

  * Build `worktreePaths` map from results

  * Update project row with `worktreePaths`

  * On failure: delete DB row + best-effort cleanup of created worktrees (compensating action)

* When `createWorktree` is true: pass `effectiveWorkspace()` to `initProjectDir()` so spec files are created in the worktree

**Add&#x20;**`project.addWorktree`**&#x20;mutation** (for existing projects):

* Input: `{ workspaceSlug: string, projectSlug: string }`

* Validates: project exists, no worktrees yet, workspace has repos

* Creates worktrees for all repos (same logic as above)

* Updates project row with `worktreePaths`

* On failure: throws error (project already exists, no compensating delete needed)

Extract shared `createWorktreesForProject(repos, slug, state)` helper.

**Update&#x20;**`project.getBySlug`**:**

* Use `effectiveWorkspace()` when computing `projectDir` path

* Return `worktreePaths` in response

* Return `effectiveRepos` in response (computed from workspace repos + project worktreePaths)

**Update all spec file procedures** (listFiles, getSpec, updateSpec, readFile, writeFile, etc.):

* When building workspace object for service calls, use `effectiveWorkspace()` if project has worktreePaths

* This is 12+ procedures — they all follow the same pattern of passing `{ slug: workspace.slug, docsDir: workspace.docsDir }` to service functions. The change is to pass `effectiveWorkspace(workspace, project.worktreePaths)` instead.

### 7. Terminal/Quick Action Updates

**Frontend changes** — the repos replacement happens in the UI components using data returned by `getBySlug`:

`web/src/components/projects/task-quick-actions.tsx` (line 44, 53):

```typescript
// Before: const repos = Array.isArray(workspace?.repos) ? ...
// After: use effectiveRepos from project response
const repos = project?.effectiveRepos ?? (Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : []);
```

`web/src/components/projects/milestone-quick-actions.tsx` (line 31, 34):\
Same pattern as task-quick-actions.

`web/src/components/terminal/use-terminal-scope.ts` (lines 46-54):

* Fetch project data via `trpc.project.getBySlug` when `projectSlug` is present

* Pass `project?.effectiveRepos ?? repos` to `deriveScope`

`web/src/lib/shell.ts` — no changes needed. `buildQuickActionDirs` already takes repos as parameter; callers pass the effective repos.

### 8. MCP Updates

`web/src/server/mcp/index.ts`:

* `getProjectDetails`: include `worktreePaths` and computed `effectiveRepos` in response

* Use `effectiveWorkspace()` when computing `projectDir` and `specDir` paths

### 9. UI

`web/src/components/projects/create-project-dialog.tsx`:

* Add checkbox "Create git worktree" (native `<input type="checkbox">` with Tailwind, no Radix dep needed)

* Only show when workspace has repos (fetch workspace data)

* Pass `createWorktree` boolean to mutation

`web/src/components/projects/project-overview.tsx`:

* Accept `worktreePaths` and `workspaceRepos` in Project type

* When project has no `worktreePaths` and workspace has repos, show "Create Worktree" button next to "Add Milestone"

* Calls `project.addWorktree` mutation

* On success: invalidate project queries, show toast

* Hide button once worktree exists

### 10. Testing + Validation

* **client/src/git/index.test.ts** — test `addWorktree` function

* **web/src/server/ws/server.test.ts** — test worktree add response handling + dispatch

* **web/src/server/trpc/routers/project.test.ts** — test: creation without worktree still works, `effectiveWorkspace` logic, `effectiveRepos` logic

* **web/src/lib/shell.test.ts** — existing tests should pass unchanged

* Run `/engy:review`, run `pnpm blt` and test in Chrome

## Critical Files

| File                                                      | Change                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `web/src/server/db/schema.ts`                             | Add `worktreePaths` to projects                                                                 |
| `common/src/ws/protocol.ts`                               | Add worktree request/response types                                                             |
| `common/src/index.ts`                                     | Re-export new types                                                                             |
| `client/src/git/index.ts`                                 | Add `addWorktree()`                                                                             |
| `client/src/ws/client.ts`                                 | Handle `GIT_WORKTREE_ADD_REQUEST`                                                               |
| `web/src/server/trpc/context.ts`                          | Add `pendingGitWorktreeAdd` to AppState                                                         |
| `web/src/server/ws/server.ts`                             | Handle response + add dispatch function                                                         |
| `web/src/server/trpc/routers/project.ts`                  | Core logic: create, addWorktree, effectiveWorkspace, effectiveRepos, update all spec procedures |
| `web/src/server/mcp/index.ts`                             | Include worktree data in responses                                                              |
| `web/src/components/projects/create-project-dialog.tsx`   | Checkbox UI                                                                                     |
| `web/src/components/projects/project-overview.tsx`        | Retroactive button                                                                              |
| `web/src/components/projects/task-quick-actions.tsx`      | Use effective repos                                                                             |
| `web/src/components/projects/milestone-quick-actions.tsx` | Use effective repos                                                                             |
| `web/src/components/terminal/use-terminal-scope.ts`       | Use effective repos                                                                             |

## Out of Scope

* Worktree removal on project delete (follow-up)

* Workspace-level `worktreeDir` configuration UI (follow-up — default `.claude/worktrees` is sufficient)

* Worktree cleanup/prune commands (follow-up)
