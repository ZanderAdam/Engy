---
subtype: insight
title: Terminal paste reads the CLI host's clipboard — a mobile Paste key cannot work
keywords:
  - clipboard
  - OSC 52
  - navigator.clipboard
  - insecure context
  - bracketed paste
  - ^V
themes:
  - mobile
  - terminal
  - clipboard
tags:
  - terminal
  - mobile
sources: []
linkedMemories:
  - >-
    memory/decisions/20260801213130-mobile-terminal-input-goes-through-a-compose-overlay-not-xte.md
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/decisions/20260801213120-close-the-key-rail-while-composing-rather-than-arbitrating-p.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/decisions/20260801213110-mobileidentitybar-mounts-at-three-sites-to-stay-inside-mobil.md
scenarioIds: []
---
**Rule:** Do not add a "Paste" affordance to the mobile terminal rail. To get a phone-held image or text into a prompt, capture bytes in the composer, cross the WebSocket, write a file on the machine the CLI runs on, and put *that path* into the prompt.

**Why:** Engy contains no clipboard code at all — `^V` (`\x16`) is just a byte on the relay, and the agent CLI reads the clipboard of the machine *it* runs on. On desktop that happens to be the machine the user copied from; from a phone it is still the dev machine's clipboard, never the phone's. A Paste key therefore already effectively exists and pastes the wrong machine's clipboard. Two further walls: a PTY carries no image channel at all (xterm's clipboard addon is OSC 52, text-only), and `navigator.clipboard` is undefined on a phone anyway because `web/server.ts` is plain `node:http`, making a LAN-IP origin an insecure context.

**Connects to:** the mobile key panel labels the key `^V` and never "Paste", precisely so this asymmetry is not implied. The riskiest part of the file-path route is translating the path per execution mode (host vs devcontainer vs coder), not the upload itself.
