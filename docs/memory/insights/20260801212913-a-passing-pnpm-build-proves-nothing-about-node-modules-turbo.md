---
subtype: insight
title: >-
  A passing pnpm build proves nothing about node_modules — Turbo may not have
  run it
keywords:
  - turbo cache
  - verifyDepsBeforeRun
  - ERR_MODULE_NOT_FOUND
  - node_modules
  - pnpm-workspace.yaml
  - TS2307
  - pm2
themes:
  - build
  - tooling
  - dependencies
tags:
  - dx
  - tooling
sources: []
linkedMemories:
  - >-
    memory/insights/20260801212634-judge-blt-s-eslint-output-by-file-path-not-problem-count.md
scenarioIds: []
---
**Rule:** Never treat a green `pnpm build` as evidence that the dependency graph is installable. A Turbo cache hit means the build script never ran at all, so a stale or pruned `node_modules` is completely invisible. Rely on `verifyDepsBeforeRun: install` in `pnpm-workspace.yaml` instead.

**Why:** Turbo hashes tracked sources, `package.json`, and the lockfile — not `node_modules` contents. A cache hit restores `dist/` from `.turbo/cache` with fresh mtimes, so timestamps do not reveal it, and `tsc` is never invoked. The missing dependency surfaces only at runtime as `ERR_MODULE_NOT_FOUND`. Turbo's cache is content-addressed and shared across worktrees, so one worktree's successful build can mask another's broken `node_modules`; the replayed log prints the producing worktree's path, which is the tell.

**Evidence:** `pnpm build` AND `pnpm start` both reported success while the client daemon crash-looped on `Cannot find package '@xterm/headless'`. `tsc` was not weak here — forcing a real compile produced 9 × TS2307 and exit 2. No build ran. PM2 compounded it by reporting the daemon "online" with restarts=0, because the crash loop restarted faster than `pm2 list` sampled it; only the error log revealed the truth. The cache entry replayed had been produced in a different worktree where the deps were installed.

**Connects to:** `verifyDepsBeforeRun: install` was chosen over a hand-rolled `pnpm install &&` prefix on each script — that was the first attempt and was strictly worse: ~2.2s per run versus ~0.1s measured, and it only covered the four entry-point scripts someone remembered rather than every `pnpm run`. The setting works on pnpm 10.30.3 (verified empirically — desync a package.json and it fires `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`); pnpm 11 makes `install` the default. It must live in `pnpm-workspace.yaml`, not `.npmrc`, because pnpm 11 restricts `.npmrc` to auth/registry keys and would silently drop it on upgrade.
