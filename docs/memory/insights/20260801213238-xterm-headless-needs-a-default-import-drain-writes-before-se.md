---
subtype: insight
title: '@xterm/headless needs a default import; drain writes before serializing'
keywords:
  - '@xterm/headless'
  - SerializeAddon
  - ITerminalAddon
  - UMD
  - cjs-module-lexer
  - handleReconnect
  - vi.waitFor
themes:
  - terminal
  - daemon
  - esm
tags:
  - terminal
  - daemon
sources: []
linkedMemories:
  - >-
    memory/decisions/20260623233407-daemon-activity-badge-stays-done-until-typed-into-exit-no-vi.md
  - >-
    memory/decisions/20260801212804-terminal-session-metadata-mirrors-to-sqlite-because-daemon-c.md
  - >-
    memory/patterns/20260801213229-browser-only-terminal-ws-messages-are-typed-but-excluded-fro.md
  - >-
    memory/decisions/20260623233244-terminal-activity-detection-is-intentionally-duplicated-daem.md
  - >-
    memory/patterns/20260623233039-kill-is-final-server-sends-t-exit-before-close-1001-to-suppr.md
  - >-
    memory/insights/20260801213319-initial-command-injection-races-interactive-shell-startup.md
  - >-
    memory/conventions/20260801213430-gh-api-paginate-needs-slurp-before-json-parse.md
scenarioIds: []
---
**Rule:** Import `@xterm/headless` via its default export (`import headless from '@xterm/headless'; const { Terminal } = headless`), cast the serialize addon (`screen.loadAddon(serializeAddon as unknown as ITerminalAddon)`), and always drain xterm's async write queue with `screen.write('', cb)` before serializing.

**Why:** `@xterm/headless` ships a UMD bundle whose named exports Node's ESM loader cannot detect, while `@xterm/addon-serialize`'s named `SerializeAddon` import works fine — cjs-module-lexer handles the addon but not the headless bundle, so two sibling packages need different import styles in the same file. The addon's types target the DOM build's `Terminal`, so the cast is required; same core at runtime, upstream types just do not cover the pairing. Without draining, output that arrived just before a reconnect is missing from the snapshot.

**Connects to:** the daemon's `handleReconnect` sends the `reconnected` message inside that drain callback, which is what makes the manager tests async (`vi.waitFor`).
