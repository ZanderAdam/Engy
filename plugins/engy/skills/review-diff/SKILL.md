---
name: review-diff
description: "This skill should be used when a repoDir and an explicit diff scope (staged, unstaged, a commit, or a commit range) need reviewing with findings written back as inline diff comments — reviewing a colleague's branch, a pull request diff, or local uncommitted work, wherever the scope is given explicitly rather than auto-detected."
---

# Diff Review

Review one diff scope for code the caller does not own, and write findings back onto the diff itself
so they appear inline in the Diffs tab. Unlike `/engy:review`, this skill never auto-detects scope —
the same flow serves local uncommitted work, a branch diff, and a pull request, and only the caller
knows which one is meant.

## Inputs

- `repoDir` — absolute path of the repo. Every `diff_review_*` call takes this path, so findings land
  on the diff the reader has open.
- `worktreePath` (optional) — the worktree the reader is looking at. When given, run git here, not in
  `repoDir`, and pass it as `repoDir` to every `diff_review_*` call, so findings land on the
  worktree's branch.
- `reviewGuide` (optional) — absolute path of a project review guide.
- A `GitPatchSpec` naming the two snapshots to compare:
  - `{ kind: 'staged', head? }` — last commit against the index (`git diff --cached`)
  - `{ kind: 'unstaged' }` — index against the working tree (`git diff`)
  - `{ kind: 'commit', hash }` — a commit against its first parent
  - `{ kind: 'range', from, to? }` — an explicit range; `to` absent means the working tree

If either input is missing, ask for it — do not guess a scope.

## MCP Tools

- `diff_review_list({ repoDir, filePath? })` — findings already filed on this diff and the human
  comments left on it. Call this **first**, every time.
- `diff_review_comment({ repoDir, filePath, lineNumber, codeLine, side?, severity, finding,
  failureScenario, suggestedFix? })` — one anchored finding. `side` is `'modified'` (default) or
  `'original'`; only use `'original'` for a deleted line, which has no line on the new side to
  anchor to. `lineNumber` is in that side's own numbering.
- `diff_review_summary({ repoDir, summary, risk?, readingOrder?, guide? })` — the single unanchored summary shown above the first
  file. Replaces any previous summary; anchored findings are untouched.

## Process

### Step 1: Load the guide

Read `${CLAUDE_PLUGIN_ROOT}/skills/review-diff/references/review-guide.md`. It has two sections,
`## Overview` and `## Review`. If `reviewGuide` is given and readable, each of those two sections
present in that file replaces the default's same section; a section it lacks keeps the default.
Follow the merged guide for the rest of the run. Remember `guide: 'project'` when the file was used,
else `guide: 'default'`.

### Step 2: Read existing state

Call `diff_review_list({ repoDir })`. This returns two things that change what you do next:

- **Existing findings** (`type: 'diff'`, `source: 'agent'`) — do not re-file these. If the diff has
  changed underneath one, re-anchor or update it; otherwise leave it standing.
- **Human comments** (`source: 'local'`) — a re-review must answer every open one. For each: check
  whether the current diff addresses it, then say so in the summary (or file a new anchored finding
  if the concern is still live and still actionable). Never ignore one silently.

### Step 3: Dispatch `engy:reviewer` in review-only mode

Translate the `GitPatchSpec` to the git invocation the agent should run in `worktreePath` when
given, else in `repoDir`:

| `kind` | command |
|---|---|
| `staged` | `git diff --cached` |
| `unstaged` | `git diff` |
| `commit` | `git diff <hash>^..<hash>` |
| `range` | `git diff <from>..<to>` (omit `..to` for the working tree) |

Dispatch via the Agent tool:

```
Agent tool:
  subagent_type: engy:reviewer
  prompt: |
    Run in mode: review-only (Phase 3 alone — do not simplify or edit anything).

    Repo: <worktreePath, else repoDir>
    Diff: <git command from the table above>

    Findings already filed on this diff (do not repeat):
    <paste diff_review_list findings>

    Open human comments to answer:
    <paste diff_review_list human comments>

    What to look for and what to ignore (the merged guide's Review section):
    <paste it>

    Grade every Critical/High finding against the evidence ladder at
    ${CLAUDE_PLUGIN_ROOT}/skills/implement/references/evidence-ladder.md and carry the rung into the
    finding text.
```

Because this reviews code the dispatching session does not own, exclude `Write` and `Edit` from the
agent's tool access for this call — it should not be able to edit the branch under review, even by
accident, per the `mode: review-only` note in `agents/reviewer.md`.

### Step 4: Write results back

Take the agent's Phase 3 output and split it across the two tools, following the merged guide. Its
`## Review` section decides what is anchored with `diff_review_comment`. Its `## Overview` section
decides what goes in `diff_review_summary` and in the `risk` and `readingOrder` fields. Pass `guide`
on the same call. Call `diff_review_summary` once with the full text — it replaces whatever summary
is already there.

## Key Principles

- **Scope is given, never inferred.** No auto-detection of staged/unstaged/commit/range — that is
  what makes this skill reusable for local work, branch review, and PRs alike.
- **Read before you write.** `diff_review_list` first, every call — a re-review that repeats a
  standing finding or ignores an open human comment has failed regardless of what else it found.
- **The summary is the pressure valve.** It keeps the anchored tier rare enough that a human
  actually reads all of it. Zero anchored findings is a correct result for a clean diff.
- **No parallel confidence vocabulary.** Grade against the evidence ladder's rungs 1-5 and the
  VERIFIED / NOT VERIFIED / INCONCLUSIVE verdicts — never a numeric confidence score, which reads as
  earned when it is only a hedge.

## Additional resources

- Evidence ladder and verdicts: [../implement/references/evidence-ladder.md](../implement/references/evidence-ladder.md)
- Review-only mode contract: [../../agents/reviewer.md](../../agents/reviewer.md)
