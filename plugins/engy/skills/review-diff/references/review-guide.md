# Review Guide

## Overview

What to emphasise in the guided review. Its shape (groups, system context, risk) is fixed by the
skill and applies with any guide.

- `overview`: what the change does and why, for a reader who has not seen the work.
- Group explanations: lead with the change in behaviour, then the consequences a caller sees.
  Name the risk drivers a reviewer can verify: shared code paths, persisted data, public contracts.
- `summary` notes, in this order:
  1. Architectural decisions in the diff and their rationale.
  2. Impact and breaking-change assessment.
  3. Answers to open human comments.
  4. Observations not worth anchoring: style, minor naming, test-coverage nags, speculative
     refactor ideas, anything Medium or below that did not earn a line above.

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
