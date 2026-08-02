---
subtype: insight
title: Initial-command injection races interactive shell startup
keywords:
  - initialCommandSent
  - PTY
  - oh-my-zsh
  - zle
  - spawn command
  - TerminalManager
themes:
  - terminal
  - daemon
tags:
  - terminal
  - daemon
sources: []
linkedMemories:
  - >-
    memory/insights/20260801213238-xterm-headless-needs-a-default-import-drain-writes-before-se.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/conventions/20260801213329-a-buildcommand-change-must-account-for-all-three-terminalses.md
  - >-
    memory/conventions/20260801213430-gh-api-paginate-needs-slurp-before-json-parse.md
scenarioIds: []
---
**Rule:** Do not inject a spawn command into a PTY on first shell output. Wait for a stable prompt (or zle readiness), or prefix the command with a newline to flush any pending prompt.

**Why:** the daemon's `initialCommandSent` path types the command on the first byte of shell output, before the line editor is ready. On a host with oh-my-zsh's update prompt (`[Y/n]`), the first character of the injected command answers that prompt, leaving `laude ...` / `odex ...` → "command not found". Even without the omz prompt, a fresh zsh under load can swallow the first byte.

**Evidence:** reproduced consistently in fresh dev-worktree shells. It affects EVERY agent terminal spawn, fresh and resume alike — not any single feature. Likely masked in daily prod use by faster shell startup and omz's update interval marker, which is why it reads as intermittent.
