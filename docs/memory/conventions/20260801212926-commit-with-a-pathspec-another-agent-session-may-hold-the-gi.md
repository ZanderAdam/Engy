---
subtype: convention
title: Commit with a pathspec — another agent session may hold the git index
keywords:
  - git index
  - git commit pathspec
  - git diff --cached
  - concurrent sessions
  - staged files
themes:
  - git
  - multi-agent
tags:
  - workflow
  - git
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** Treat the git index as shared mutable state another live agent session can be holding mid-commit. Re-check `git diff --cached` before committing; if someone else's files are staged, commit your own with a pathspec — `git commit <path> -F-` — which builds the commit from HEAD plus the named paths and ignores the index entirely, rather than `git add` + `git commit`, which would sweep their staged work into your commit.

**Why:** a pathspec commit satisfies the standing "do not stage additional changes if there are already changes staged" rule without blocking on the other session.

**Evidence:** the index went from empty to 24 staged files in the ~10 minutes between two commits, with no signal in the observing session other than an ambient system-reminder that available agent type names had changed. The staged set then emptied itself again because that session committed independently while the first was still verifying.

**Connects to:** snapshot the staged file list before committing and diff it after, to prove nothing of theirs was absorbed — that before/after diff also tells you whether the index emptied because you consumed it or because they committed. Relevant to any milestone flow where a task ends in a commit.
