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
linkedMemories: []
scenarioIds: []
---
**Rule:** Import `@xterm/headless` via its default export (`import headless from '@xterm/headless'; const { Terminal } = headless`), cast the serialize addon (`screen.loadAddon(serializeAddon as unknown as ITerminalAddon)`), and always drain xterm's async write queue with `screen.write('', cb)` before serializing.

**Why:** `@xterm/headless` ships a UMD bundle whose named exports Node's ESM loader cannot detect, while `@xterm/addon-serialize`'s named `SerializeAddon` import works fine — cjs-module-lexer handles the addon but not the headless bundle, so two sibling packages need different import styles in the same file. The addon's types target the DOM build's `Terminal`, so the cast is required; same core at runtime, upstream types just do not cover the pairing. Without draining, output that arrived just before a reconnect is missing from the snapshot.

**Connects to:** the daemon's `handleReconnect` sends the `reconnected` message inside that drain callback, which is what makes the manager tests async (`vi.waitFor`).
