# Atomicity check — examples and rationale

A fleeting memory must carry ONE central claim. When the body restates content that belongs in a sibling memory, retrieval rank for unrelated queries gets stolen by keyword density.

## What to scan for

**Sibling-context bleed** — the body restates a fact or decision that has (or should have) its own memory.

> Example: a memory about diff-viewer UI that also explains how the daemon serves git ops — the daemon facts belong in a daemon memory.

**Multi-claim body** — two distinct claims joined by "and" or "also". One memory, one claim.

## How to handle

Before presenting metadata to the user, prompt: "This memory mixes claim A with claim B. Promote A and re-capture B? [yes/no]"

- **yes** — trim body to A, propose metadata for A, continue. Optionally call `createFleetingMemory` again for B.
- **no** — proceed, but flag in the user prompt: "⚠ atomicity: this memory restates content that belongs in `<sibling-memory-path>` — review keywords carefully."

## Why this matters

Search relevance is keyword-density driven. A memory that restates sibling content wins queries it shouldn't and starves the rightful answer's retrieval rank.
