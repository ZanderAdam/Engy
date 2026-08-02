---
subtype: insight
title: 'Judge blt''s eslint output by file path, not problem count'
keywords:
  - blt
  - eslint
  - dist-server
  - no-unused-vars
  - scripts/
  - 'lint:eslint'
  - turbo
themes:
  - tooling
  - quality-gates
tags:
  - dx
  - tooling
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Judge `pnpm blt`'s eslint output by the file paths in it, never by the total problem count — and never assume it covers root-level `scripts/`.

**Why:** Two independent gaps make the count meaningless. A second blt run after a prior successful build also lints `web/dist-server/server.mjs`, the esbuild bundle, adding ~9 phantom `no-unused-vars` warnings on names that only exist post-bundling (`_schemaTypesMatch`, `VALID_MEMORY_SUBTYPES`, `prRouter`, `executionRouter`) — so "11 problems" becomes "20 problems" on a tree that did not change in that respect, reading exactly like the change introduced them. Separately, `lint:eslint` is a per-package turbo task (common/client/web), and root files sit outside every package, so no lint task ever reaches `scripts/*.mjs`. `npx eslint scripts/dev.mjs` reports real `no-undef` errors that blt structurally cannot see, and with no `.github/workflows/` in the repo CI does not cover them either — actually running `pnpm dev` is the only gate for a `scripts/` change.

**Connects to:** the blt-runs-once convention — rerunning blt to check a `scripts/` edit cannot work, and the second run is precisely when the phantom warnings appear. Also relevant: blt exits 1 on knip findings even when every turbo task reports success, so "Tasks: N successful" plus a non-zero exit means knip, not tests.
