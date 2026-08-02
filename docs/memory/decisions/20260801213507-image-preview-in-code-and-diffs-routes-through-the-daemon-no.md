---
subtype: decision
title: 'Image preview in Code and Diffs routes through the daemon, not server fs'
keywords:
  - FILE_READ_IMAGE_REQUEST
  - file.readImage
  - getFileBytes
  - git show
  - 'encoding:buffer'
  - NonTextFileView
  - imageMimeType
themes:
  - file-viewing
  - diffs
  - daemon
tags:
  - architecture
  - ui
sources: []
linkedMemories:
  - >-
    memory/decisions/20260801213407-code-tab-s-worktree-selector-is-localonly-because-tree-ops-l.md
  - >-
    memory/patterns/20260801212739-monaco-diffeditor-needs-per-file-model-paths-and-scrolltop-o.md
scenarioIds: []
---
**Rule:** Image and binary preview in the Code and Diffs tabs must route through the client daemon (`FILE_READ_IMAGE_REQUEST`/`RESPONSE` → `file.readImage` tRPC), not the server-fs reader (`dir.readImage`/`readImageAsDataUri`) that the docs editor uses.

**Why:** the docs editor's path reads bytes off the server filesystem with `fs.readFileSync`, which cannot satisfy the Diffs tab — that needs to read an image from a git ref (HEAD, commit, `commit~1`, branch) and from coder/worktree paths, none of which a plain fs read covers. The daemon byte-reader (`getFileBytes`) does `git show <ref>:<path>` captured as a Buffer for refs, else an fs read, and pipes through remote `base64` for coder. The web side builds the data URI from the returned base64 plus `imageMimeType()`.

**Evidence:** the binary subtlety is load-bearing — `getFileContent` uses `git show` decoded as utf-8, which corrupts binary; `getFileBytes` captures with `encoding:'buffer'` to preserve bytes.

**Connects to:** it mirrors the existing daemon dispatch pattern (`dispatchFileRead`/`pendingFileRead`) which already handles refs, worktrees and coder for text. `NonTextFileView` (image + binary states) is shared by code-page, diffs-page and `FileContentPreview`; `ImageDiffView` shows before/after for modified and renamed images.
