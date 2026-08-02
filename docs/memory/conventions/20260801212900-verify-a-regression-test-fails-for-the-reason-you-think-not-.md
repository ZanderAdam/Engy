---
subtype: convention
title: >-
  Verify a regression test fails for the reason you think, not just that it
  fails
keywords:
  - realpathSync
  - mkdtempSync
  - os.tmpdir
  - assertWithinAllowedRoots
  - symlink
  - path containment
themes:
  - testing
  - path-handling
tags:
  - testing
  - macos
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Reverting the fix to confirm a regression test catches the bug is necessary but not sufficient — also confirm it fails for the *reason* you believe. A security test that passes vacuously is worse than no test, because it certifies the gap. Concretely on macOS: always `fs.realpathSync()` a temp root at creation before using it in path-containment assertions.

**Why:** `/var` is a symlink to `/private/var`, so the lexical and resolved forms of an `os.tmpdir()` path differ even with no symlink under test. `mkdtempSync` returns `/var/folders/...` while `realPath(root)` returns `/private/var/folders/...`, and that mismatch alone makes any candidate path look outside the root.

**Evidence:** a regression test for a symlink-escape bug in `assertWithinAllowedRoots` was run against the *buggy* implementation to prove it caught the bug — and it passed, reporting "secure". The assertion threw for a reason that had nothing to do with the planted symlink. Wrapping `mkdtempSync` in `fs.realpathSync()` isolated the symlink as the only variable, and the test then correctly failed against the buggy version.

**Connects to:** the fix it was covering — `realPath()` must walk up to the nearest EXISTING ancestor, not just one level. With `repo/link -> outside`, a candidate `repo/link/newdir/newfile.txt` has a non-existent parent too, so a single-level fallback returns the unresolved lexical path, which still looks contained.
