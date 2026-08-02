---
description: Agreed practices and standards
---

Permanent notes on conventions — agreed coding standards, process norms, and team practices.

<!-- INDEX START -->

- [20260801212648-scrollarea-in-a-flex-column-needs-min-h-0-plus-the-viewport-.md](20260801212648-scrollarea-in-a-flex-column-needs-min-h-0-plus-the-viewport-.md) — **Rule:** A `<ScrollArea>` used as a flex-column child must carry `flex-1 min-h-
- [20260801212843-never-mirror-xterm-s-auto-follow-state-in-app-code.md](20260801212843-never-mirror-xterm-s-auto-follow-state-in-app-code.md) — **Rule:** Never mirror xterm's auto-follow state in application code. `BufferSer
- [20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md](20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md) — **Rule:** Any drag gesture over xterm content must use pointer events plus `setP
- [20260801212900-verify-a-regression-test-fails-for-the-reason-you-think-not-.md](20260801212900-verify-a-regression-test-fails-for-the-reason-you-think-not-.md) — **Rule:** Reverting the fix to confirm a regression test catches the bug is nece
- [20260801212926-commit-with-a-pathspec-another-agent-session-may-hold-the-gi.md](20260801212926-commit-with-a-pathspec-another-agent-session-may-hold-the-gi.md) — **Rule:** Treat the git index as shared mutable state another live agent session
- [20260801213001-assert-mcp-zod-constraints-against-the-schema-not-through-ca.md](20260801213001-assert-mcp-zod-constraints-against-the-schema-not-through-ca.md) — **Rule:** To test a zod-only constraint on an MCP tool (e.g. `content.min(1\)`\), 
- [20260801213018-never-compare-a-qmd-search-score-to-a-cosine-threshold.md](20260801213018-never-compare-a-qmd-search-score-to-a-cosine-threshold.md) — **Rule:** Only compare scores to a cosine threshold when they came from `searchV
- [20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md](20260801213044-full-screen-mobile-overlays-use-z-60-and-tailwind-breakpoint.md) — **Rule:** Full-screen mobile overlays in `web/` must use `z-[60\]` and responsive
- [20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md](20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md) — **Rule:** When reviewing z-index inside a portaled or nested overlay, hit-test w
- [20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md](20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md) — **Rule:** Every per-tab Radix Sheet/Dialog mounted inside a TabPanel must gate i
- [20260801213201-terminal-pane-surfaces-hardcode-zinc-and-get-restyled-by-att.md](20260801213201-terminal-pane-surfaces-hardcode-zinc-and-get-restyled-by-att.md) — **Rule:** Adding a themed surface to the terminal pane is a two-file change: har
- [20260801213304-brace-shell-variables-in-git-rev-path-arguments-zsh-eats-the.md](20260801213304-brace-shell-variables-in-git-rev-path-arguments-zsh-eats-the.md) — **Rule:** Always brace a shell variable used to build a git `rev:path` argument 
- [20260801213311-use-playwright-cli-goto-not-open-open-relaunches-and-wipes-l.md](20260801213311-use-playwright-cli-goto-not-open-open-relaunches-and-wipes-l.md) — **Rule:** Use `goto <url>` for navigation within a playwright-cli session. Reser
- [20260801213329-a-buildcommand-change-must-account-for-all-three-terminalses.md](20260801213329-a-buildcommand-change-must-account-for-all-three-terminalses.md) — **Rule:** Any change to what `claude`/`codex` `buildCommand` emits (`web/src/lib
- [20260801213339-file-watching-is-subscription-driven-a-file-change-consumer-.md](20260801213339-file-watching-is-subscription-driven-a-file-change-consumer-.md) — **Rule:** Any new `FILE_CHANGE` consumer must declare its paths via `useWatchPat
- [20260801213349-grep-the-whole-requirements-table-for-the-max-fr-id-before-a.md](20260801213349-grep-the-whole-requirements-table-for-the-max-fr-id-before-a.md) — **Rule:** When allocating a new FR id in a `system/features` doc, grep the ENTIR
- [20260801213422-a-new-project-section-tab-needs-three-wiring-points-not-two.md](20260801213422-a-new-project-section-tab-needs-three-wiring-points-not-two.md) — **Rule:** Adding a project section tab requires THREE wiring points: the `sectio
- [20260801213430-gh-api-paginate-needs-slurp-before-json-parse.md](20260801213430-gh-api-paginate-needs-slurp-before-json-parse.md) — **Rule:** Every `gh api --paginate` call in the daemon must add `--slurp` (then 
- [20260801213448-expand-tilde-at-the-server-boundary-the-daemon-is-never-tild.md](20260801213448-expand-tilde-at-the-server-boundary-the-daemon-is-never-tild.md) — **Rule:** Expand `~` at the SERVER boundary via `expandTilde` (exported from `we
- [20260801213456-mutate-worktrees-at-the-path-git-reports-never-a-recomputed-.md](20260801213456-mutate-worktrees-at-the-path-git-reports-never-a-recomputed-.md) — **Rule:** Any worktree *mutation* must target the path `git worktree list` actua

<!-- INDEX END -->
