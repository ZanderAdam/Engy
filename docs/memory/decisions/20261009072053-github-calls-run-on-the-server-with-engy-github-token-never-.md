---
subtype: decision
title: >-
  GitHub calls run on the server with ENGY_GITHUB_TOKEN, never through the
  daemon's gh
keywords:
  - ENGY_GITHUB_TOKEN
  - gh auth token
  - githubGraphql
  - githubRest
  - Notifications API
  - fine-grained PAT
  - classic token
  - github.status
themes:
  - github
  - authentication
tags:
  - architecture
  - server
  - security
scenarioIds:
  - FR-PRMON-130
linkedMemories:
  - >-
    memory/decisions/20260801213438-pr-monitoring-authenticates-via-the-user-s-gh-auth-login-sto.md
sources: []
---
**Rule:** All GitHub I/O (PR list, CI checks, notifications, timelines, review threads, review writes) runs on the server through `web/src/server/github/` with a classic token from the `ENGY_GITHUB_TOKEN` env var, set in `.env` (dev: `.dev.env`) and created with `gh auth token`. The server never stores the token in the DB. The daemon never receives it: `scripts/dev.mjs` strips it from the env handed to turbo, because the daemon spawns agents and agents must not see it. The daemon still answers one git op, reading a repo's `origin` URL, which `resolveRepoFullName` (`github/repo-identity.ts`) maps to `owner/name`.

**Why:** This replaced the M11 decision "the daemon shells out to `gh`, Engy never sees a token" (M15 plan, user decision 3):
- Conditional polling of `/notifications` is cheap: a `304` does not count against the rate limit.
- Resolving review threads needs GraphQL.
- Each `gh` call cost one process spawn plus one WebSocket round trip.
- Coder workspaces no longer need a `gh` exec path.

**Constraints:**
- The token must be a classic token with the `repo` and `notifications` scopes. The Notifications API does not accept fine-grained tokens (`github_pat_…`); `github/viewer.ts` reports them as unavailable.
- One token means github.com only. GitHub Enterprise and other hosts are out of scope.
- `github.status` reports a missing, rejected or under-scoped token, and every GitHub-backed surface shows that message.

**Evidence:** `docs/projects/initial/milestones/m15-pr-inbox-review.plan.md` (decision 3, TG1), `docs/system/features/pr-monitoring.md` (Architecture), commit 56fdf5aa (deleted `client/src/gh/`).
