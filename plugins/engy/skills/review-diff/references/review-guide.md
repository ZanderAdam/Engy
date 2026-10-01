# Review Guide

## Overview

What the summary passed to `diff_review_summary` must contain, in this order:

1. Three-sentence structural overview of the change.
2. Reading order: which files to read in what sequence, and what to check in each. This is the
   highest-value part of the summary for a large diff.
3. Architectural decisions in the diff and their rationale.
4. Impact and breaking-change assessment.
5. Observations not worth anchoring: style, minor naming, test-coverage nags, speculative refactor
   ideas, anything Medium or below that did not earn a line above.

Structured fields on the same call:

- `risk: { level, reason }`. `level` is `low`, `typical`, `high` or `very_high`: how likely the
  change breaks something, and how much depends on what it touches. `reason` is one or two
  sentences (max 300 characters) naming what drives the level.
- `readingOrder: [{ title, files, note }]`, max 20 chapters. Core change first, then supporting
  code, then tests and glue. Group related files into one chapter, one-line `note` each on what to
  check. `files` are repo-relative paths from the diff.

## Review

Anchor with `diff_review_comment` only what a reader must act on. Hard cap: about 10. In practice
this is Critical and High findings, and only a Medium finding concrete and severe enough that
skipping it would be a mistake.

Every anchored finding needs:

- `finding`: the claim, one sentence, with the evidence rung inline (for example "rung 4:
  `x.test.ts:12` reproduces it"). Below rung 4 on a Critical/High claim, write **unproven** and
  file it as Medium instead. A rung-1 assertion is never Critical.
- `failureScenario`: the exact input or state that produces the wrong result. If you cannot name
  one concretely, this is not a finding. Drop it.
- `suggestedFix` when there is a concrete one.

Never anchor: style, formatting, documentation, test-coverage nags, complexity opinions, and
speculative refactor suggestions. Put them in the summary's last section, in prose, if they are
worth saying at all.

Findings that are true and irrelevant cost the reader the same attention as a real bug. Spend more
effort deciding what to suppress than what to report. Zero anchored findings is a correct result for
a clean diff.
