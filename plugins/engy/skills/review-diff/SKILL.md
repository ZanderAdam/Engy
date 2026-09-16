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
  `repoDir`.
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
- `diff_review_summary({ repoDir, summary })` — the single unanchored summary shown above the first
  file. Replaces any previous summary; anchored findings are untouched.

## Process

### Step 1: Read existing state

Call `diff_review_list({ repoDir })`. This returns two things that change what you do next:

- **Existing findings** (`type: 'diff'`, `source: 'agent'`) — do not re-file these. If the diff has
  changed underneath one, re-anchor or update it; otherwise leave it standing.
- **Human comments** (`source: 'local'`) — a re-review must answer every open one. For each: check
  whether the current diff addresses it, then say so in the summary (or file a new anchored finding
  if the concern is still live and still actionable). Never ignore one silently.

### Step 2: Dispatch `engy:reviewer` in review-only mode

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

    Grade every Critical/High finding against the evidence ladder at
    ${CLAUDE_PLUGIN_ROOT}/skills/implement/references/evidence-ladder.md and carry the rung into the
    finding text.
```

Because this reviews code the dispatching session does not own, exclude `Write` and `Edit` from the
agent's tool access for this call — it should not be able to edit the branch under review, even by
accident, per the `mode: review-only` note in `agents/reviewer.md`.

### Step 3: Write results back

Take the agent's Phase 3 output and split it across the two tools — this split is the point of the
skill.

**Anchor with `diff_review_comment`** only what a reader must act on. Hard cap: about 10. In
practice this is Critical and High findings, and only a Medium finding concrete and severe enough
that skipping it would be a mistake.

Every anchored finding needs:
- `finding` — the claim, one sentence, with the evidence rung inline (e.g. "rung 4: `x.test.ts:12`
  reproduces it"). Below rung 4 on a Critical/High claim, write **unproven** and file it as Medium
  instead — a rung-1 assertion is never Critical.
- `failureScenario` — the exact input or state that produces the wrong result. If you cannot name
  one concretely, this is not a finding — drop it, do not anchor a hunch.
- `suggestedFix` when there is a concrete one.

**Everything else goes in `diff_review_summary`**, as prose, in this order:
1. Three-sentence structural overview of the change.
2. **Reading order** — which files to read in what sequence, and what to check in each. This is the
   highest-value part of the summary for a large diff.
3. Architectural decisions in the diff and their rationale.
4. Impact / breaking-change assessment.
5. Observations not worth anchoring — style, minor naming, test-coverage nags, speculative refactor
   ideas, anything Medium-or-below that didn't earn a line above.

Call `diff_review_summary` once with the full text — it replaces whatever summary is already there.

## Noise control

The failure mode here is not false positives — it is findings that are **true and irrelevant**. They
cost the same reader attention as a real bug and are harder to argue with, and once a reader starts
skipping the tool's comments it is dead for every finding after, valid ones included. Spend more
effort deciding what to suppress than what to report.

Exclude from the anchored tier, always: style, formatting, documentation, test-coverage nags,
complexity opinions, and speculative refactor suggestions. These belong in the summary's last
section, in prose, if they're worth saying at all.

**Zero anchored findings is a correct result for a clean diff.** A summary that says in one sentence
that the change looks fine is a good result, not a failure to try hard enough — do not manufacture
findings to justify the review.

## Key Principles

- **Scope is given, never inferred.** No auto-detection of staged/unstaged/commit/range — that is
  what makes this skill reusable for local work, branch review, and PRs alike.
- **Read before you write.** `diff_review_list` first, every call — a re-review that repeats a
  standing finding or ignores an open human comment has failed regardless of what else it found.
- **The summary is the pressure valve.** It is what keeps the anchored tier rare enough that a human
  actually reads all of it.
- **No parallel confidence vocabulary.** Grade against the evidence ladder's rungs 1-5 and the
  VERIFIED / NOT VERIFIED / INCONCLUSIVE verdicts — never a numeric confidence score, which reads as
  earned when it is only a hedge.

## Additional resources

- Evidence ladder and verdicts: [../implement/references/evidence-ladder.md](../implement/references/evidence-ladder.md)
- Review-only mode contract: [../../agents/reviewer.md](../../agents/reviewer.md)
