---
subtype: decision
title: 'Mobile terminal input goes through a compose overlay, not xterm''s textarea'
keywords:
  - xterm textarea
  - inputmode
  - Gboard
  - composition events
  - bracketed paste
  - compose overlay
themes:
  - mobile
  - terminal
  - input
tags:
  - terminal
  - mobile
sources: []
linkedMemories:
  - >-
    memory/decisions/20260801213120-close-the-key-rail-while-composing-rather-than-arbitrating-p.md
  - >-
    memory/conventions/20260801212851-drag-gestures-over-xterm-must-use-pointer-events-with-setpoi.md
  - >-
    memory/conventions/20260801213102-gate-per-tab-radix-overlays-on-tab-isactive-portals-escape-d.md
  - >-
    memory/decisions/20260801213110-mobileidentitybar-mounts-at-three-sites-to-stay-inside-mobil.md
  - >-
    memory/conventions/20260801213054-hit-test-z-index-in-nested-overlays-instead-of-comparing-cla.md
  - >-
    memory/insights/20260801213139-terminal-paste-reads-the-cli-host-s-clipboard-a-mobile-paste.md
scenarioIds: []
---
**Rule:** Do not try to make typing directly into xterm's hidden helper textarea work on mobile. Deliver finished text from a plain-textarea compose overlay as one bracketed paste plus a separate Enter.

**Why:** no attribute fixes it. `inputmode` does stop Android's suggestion strip (Chrome ignores autocorrect/spellcheck — crbug.com/901839), but Gboard's composition events still duplicate and jumble characters (xterm.js#3600). xterm.js's own accepted fix is swapping the textarea for a `type="password"` input — a 7-file fork we cannot take. The overlay sidesteps all of it: no per-keystroke composition ever reaches the PTY, all keyboard niceties stay on, and multi-line input works, which xterm's hidden input cannot do at all.

**Connects to:** bracketed paste already had a server-side convention in `terminal-dispatch.ts` (sentinel stripping so text cannot escape the paste region); the client helper mirrors it and additionally normalises `\n`/`\r\n` to `\r`, which is what a real terminal paste sends.
