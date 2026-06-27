---
description: Milestone lifecycle — create, list, get, update (status transitions, title rename, scope), and delete of filesystem-backed plan files.
order: 5
---

# Milestone Management

Milestones are markdown plan files stored on disk under
`<workspaceDir>/projects/<projectSlug>/milestones/` with names following the
`m{num}-{slug}.plan.md` convention. They are **not** a SQLite table — task
groups and tasks reference milestones by a `milestoneRef` text column. The
full CRUD surface is exposed via the `milestoneRouter` tRPC router
(`web/src/server/trpc/routers/milestone.ts`), backed by filesystem helpers in
`web/src/server/plan/service.ts` (`listMilestones`, `buildMilestoneFrontmatter`,
`writePlanFile`, `readPlanFile`, `deletePlanFile`, `slugify`).

## Key components

| File | Role |
|---|---|
| `web/src/server/trpc/routers/milestone.ts` | tRPC `list`, `get`, `create`, `update`, `delete` procedures; `validateStatusTransition`; `resolveProjectDir` |
| `web/src/server/plan/service.ts` | Filesystem primitives: `writePlanFile`, `readPlanFile`, `listPlanFiles`, `deletePlanFile`, `renamePlanFile`, `listMilestones`, `buildMilestoneFrontmatter`, `slugify`, `validatePath`, `normalizeMilestoneStatus`, `quoteFrontmatterValue` |
| `web/src/server/trpc/routers/milestone.test.ts` | Router-level integration tests |
| `web/src/server/plan/service.test.ts` | Service unit tests (path traversal, slugification, status normalisation, frontmatter quoting) |

## File naming and the `ref` field

A milestone's canonical filename is `m{num}-{slugify(title)}.plan.md` where
`num` may be an integer or decimal (e.g. `1.5`). The `ref` field returned by
every procedure is the string `m{num}` (e.g. `"m1"`, `"m1.5"`).
`slugify` (`service.ts:28`) lowercases the title, collapses non-alphanumeric
runs to a single hyphen, and strips leading/trailing hyphens.

## Frontmatter schema

Every milestone file begins with a YAML frontmatter block produced by
`buildMilestoneFrontmatter` (`service.ts:158`):

```yaml
---
title: <quoted if contains colon or newlines>
status: planned|planning|active|complete
scope: <optional, single line>
---
```

`quoteFrontmatterValue` (`service.ts:133`) wraps values in double quotes when
they contain `:`, `"`, or embedded newlines; newlines are collapsed to a single
space before quoting so the line-based parser can round-trip the value.

## Status lifecycle

Status transitions are enforced by `validateStatusTransition`
(`milestone.ts:24`) using the ordered sequence
`planned → planning → active → complete`. Only one-step forward transitions are
permitted, plus a single cycle-back: `complete → planned`. All other jumps or
reversals throw `BAD_REQUEST`. Newly created milestones always start as
`planned` regardless of input.

## Path safety

All file operations (`writePlanFile`, `readPlanFile`, `deletePlanFile`,
`planFileExists`, and `renamePlanFile` — applied to both old and new filename)
delegate to `validatePath` (`service.ts:4`), which resolves the candidate path
and rejects any result whose relative form starts with `..` or is absolute.
This prevents path-traversal attacks via `specSlug` or `filename` inputs.

## Hand-written plan files

Milestone files may be hand-written without YAML frontmatter. When
`milestone.update` is called on such a file, `updateFrontmatter`
(`milestone.ts:55`) prepends the generated frontmatter block and preserves the
original body content intact. The filename is unchanged when only `status` is
updated.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-MILESTONE-010 | WHEN `milestone.create` is called with a `projectId`, `num`, and `title`, the system SHALL write a `m{num}-{slug}.plan.md` file under the project's `milestones/` directory with YAML frontmatter containing `title`, `status: planned`, and optional `scope`, and SHALL return `{ ref, num, filename, title, status: "planned", scope }`. |
| FR-MILESTONE-020 | IF a file whose `m{num}` ref already exists in the milestones directory is supplied to `milestone.create`, THEN the system SHALL throw a `CONFLICT` error; IF the derived filename already exists on disk (same num + same title slug), THEN the system SHALL throw a `CONFLICT` error on that filename. |
| FR-MILESTONE-030 | WHEN `milestone.list` is called, the system SHALL read all `*.plan.md` files in the project's `milestones/` directory, parse `num` from each filename, and return the milestones sorted ascending by `num`; an empty directory SHALL return `[]`. |
| FR-MILESTONE-040 | WHEN `milestone.get` is called with a `filename`, the system SHALL return the matching milestone object; IF the filename is not present in the directory, the system SHALL throw `NOT_FOUND`. |
| FR-MILESTONE-050 | WHEN `milestone.update` is called with a new `status`, the system SHALL accept the transition only if it is a one-step forward move in the sequence `planned → planning → active → complete` or the cycle-back `complete → planned`; all other transitions SHALL be rejected with `BAD_REQUEST "invalid milestone status transition"`. |
| FR-MILESTONE-060 | WHEN `milestone.update` is called with a new `title`, the system SHALL rename the file to `m{existing.num}-{slugify(newTitle)}.plan.md`, write the updated frontmatter to the new path, and delete the old file; the body content SHALL be preserved. |
| FR-MILESTONE-070 | WHEN `milestone.update` is called on a file that has no YAML frontmatter block, the system SHALL prepend a generated frontmatter block containing `title`, `status`, and optional `scope`, while preserving the original body content; the filename SHALL remain unchanged when only `status` changes. |
| FR-MILESTONE-080 | WHEN `milestone.delete` is called, the system SHALL remove the specified `*.plan.md` file and return `{ success: true }`; IF the file does not exist, `deletePlanFile` throws, but the router catches the error and returns `{ success: true }` regardless. |
| FR-MILESTONE-090 | IF any `filename` or `specSlug` argument to a plan file operation (`writePlanFile`, `readPlanFile`, `deletePlanFile`, `planFileExists`, or `renamePlanFile` — checked on both old and new filename) contains a path-traversal sequence (e.g. `../`), THEN the system SHALL throw an error with the message `"Path traversal detected"` before any filesystem access. |
| FR-MILESTONE-100 | WHEN `listMilestones` reads milestone files, the system SHALL normalise any unrecognised or absent `status` frontmatter value to `"planned"`, and SHALL collapse multi-line `scope` values to a single space-joined line. |

## Sources

No prior knowledge found.
