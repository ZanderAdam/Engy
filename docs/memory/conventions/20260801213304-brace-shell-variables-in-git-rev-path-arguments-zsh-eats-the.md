---
subtype: convention
title: 'Brace shell variables in git rev:path arguments — zsh eats the path'
keywords:
  - zsh
  - parameter expansion
  - history modifiers
  - git cat-file
  - merge-tree
  - 'rev:path'
themes:
  - git
  - shell
tags:
  - tooling
  - git
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Always brace a shell variable used to build a git `rev:path` argument — `"${TREE}:web/src/x"`, never `"$TREE:web/src/x"`.

**Why:** zsh applies history-style modifiers to unbraced parameter expansion, so `"$TREE:web/src/x"` silently expands to `b/src/x`. The failure mangles the string rather than erroring, and surfaces as a confusing `fatal: Not a valid object name b/src/...` that looks like a git problem but is pure shell. It only bites the `$VAR:` form, and the same command works interactively in bash.

**Connects to:** comes up in pre-merge conflict checking — `git merge-tree --write-tree <a> <b>` is non-destructive and exit 0 plus a tree hash means a clean merge, then inspect merged content via `git cat-file -p "${TREE}:path"`.
