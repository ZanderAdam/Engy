---
subtype: decision
title: 'PR monitoring authenticates via the user''s gh auth login, storing no tokens'
keywords:
  - gh auth login
  - statusCheckRollup
  - Octokit
  - fine-grained PAT
  - macOS Keychain
  - gh pr list
themes:
  - github
  - authentication
tags:
  - architecture
  - daemon
sources: []
linkedMemories:
  - >-
    memory/conventions/20260801213430-gh-api-paginate-needs-slurp-before-json-parse.md
  - >-
    memory/conventions/20260801213339-file-watching-is-subscription-driven-a-file-change-consumer-.md
  - >-
    memory/decisions/20260801213358-specwatcher-polls-the-whole-docsdir-assuming-it-is-a-dedicat.md
scenarioIds: []
---
**Rule:** PR/CI monitoring authenticates exclusively through the user's existing `gh auth login` — the token is resolved by `gh` from the macOS Keychain at exec time, daemon-side. Engy stores no GitHub tokens and registers no OAuth app.

**Why:** `gh` login is a standing prerequisite anyway, since agents have been running `gh pr create` for some time. Every alternative was strictly worse: Octokit plus `@octokit/auth-oauth-device` needs an OAuth app registration plus homegrown token storage and refresh (file or DB storage being weaker than gh's keychain), and fine-grained PATs both land a secret in Engy's SQLite and have a known `statusCheckRollup` failure on org-private repos (cli/cli#12597).

**Evidence:** `gh pr list --json` with `statusCheckRollup` covers list plus CI status in ONE call, which eliminated a planned separate checks operation.
