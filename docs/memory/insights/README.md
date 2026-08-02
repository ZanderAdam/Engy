---
description: Observations and learnings
---

Permanent notes on insights — observations, hypotheses, and learnings that do not yet fit another category.

<!-- INDEX START -->

- [20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md](20260623230445-pnpm-install-at-root-can-symlink-engy-common-into-the-wrong-.md) — Running `pnpm install` at the repo root while another Claude session is active i
- [20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md](20260623230537-map-dev-server-listeners-to-worktrees-with-lsof-before-brows.md) — When multiple dev servers run across worktrees, port 3000 may belong to a differ
- [20260623232850-terminal-tab-title-pin-titlepinned-is-browser-local-lost-in-.md](20260623232850-terminal-tab-title-pin-titlepinned-is-browser-local-lost-in-.md) — Known debt — terminal tab title pin (titlePinned\) is browser-local only. A manua
- [20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md](20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md) — web/src/server/ws/*.test.ts suites bind real sockets (server.listen\) — under the
- [20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md](20260623233107-parallel-workflow-agents-sharing-a-git-worktree-can-silently.md) — Parallel Workflow agents editing the same git worktree can silently wipe each ot
- [20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md](20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md) — web WS/search test suites (src/server/search/repo-adapter.test.ts, validate.test
- [20260623233544-turbopack-dev-cache-corruption-crashes-web-but-daemon-keeps-.md](20260623233544-turbopack-dev-cache-corruption-crashes-web-but-daemon-keeps-.md) — **Core claim:** The Next 16 (turbopack canary\) `pnpm dev` web server can crash m
- [20260801212634-judge-blt-s-eslint-output-by-file-path-not-problem-count.md](20260801212634-judge-blt-s-eslint-output-by-file-path-not-problem-count.md) — **Rule:** Judge `pnpm blt`'s eslint output by the file paths in it, never by the
- [20260801212834-resync-xterm-s-viewport-when-a-hidden-dockview-panel-becomes.md](20260801212834-resync-xterm-s-viewport-when-a-hidden-dockview-panel-becomes.md) — **Rule:** When a dockview panel with `renderer: 'always'` becomes visible again,
- [20260801212913-a-passing-pnpm-build-proves-nothing-about-node-modules-turbo.md](20260801212913-a-passing-pnpm-build-proves-nothing-about-node-modules-turbo.md) — **Rule:** Never treat a green `pnpm build` as evidence that the dependency graph
- [20260801212935-tooltipprovider-is-not-global-components-outside-the-project.md](20260801212935-tooltipprovider-is-not-global-components-outside-the-project.md) — **Rule:** Any component using shadcn `<Tooltip>` that can render outside `web/sr
- [20260801212954-qmd-publishes-only-its-root-export-embed-via-store-internal-.md](20260801212954-qmd-publishes-only-its-root-export-embed-via-store-internal-.md) — **Rule:** To embed arbitrary text with qmd, use `store.internal.llm` (LlamaCpp —
- [20260801213139-terminal-paste-reads-the-cli-host-s-clipboard-a-mobile-paste.md](20260801213139-terminal-paste-reads-the-cli-host-s-clipboard-a-mobile-paste.md) — **Rule:** Do not add a "Paste" affordance to the mobile terminal rail. To get a 
- [20260801213220-wake-triggered-clear-and-replay-is-what-corrupts-terminal-sc.md](20260801213220-wake-triggered-clear-and-replay-is-what-corrupts-terminal-sc.md) — **Rule:** Do not force-close a healthy terminal socket on `visibilitychange`. Pr
- [20260801213238-xterm-headless-needs-a-default-import-drain-writes-before-se.md](20260801213238-xterm-headless-needs-a-default-import-drain-writes-before-se.md) — **Rule:** Import `@xterm/headless` via its default export (`import headless from
- [20260801213319-initial-command-injection-races-interactive-shell-startup.md](20260801213319-initial-command-injection-races-interactive-shell-startup.md) — **Rule:** Do not inject a spawn command into a PTY on first shell output. Wait f

<!-- INDEX END -->
