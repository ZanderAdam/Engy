---
title: M7 Knowledge Layer — Eval Plan
status: planned
---

# M7 Eval Plan

Plan for benchmarking the M7 ingestion + retrieval pipeline against public datasets, with a custom calibration corpus for ingestion-specific behavior. Sibling doc to `m7-validation.md` (which covers structural/integration correctness — this doc covers *quality* of ingest classification, distillation, retrieval relevance, and contradiction flagging).

## Goal

Move M7 from "code works" (validation: passing tests, pipeline executes) to "M7 produces useful results" (eval: search returns the right docs, ingest classifies correctly, contradictions are caught). Establish numbers we can track over time as we tune qmd, the auto-link threshold, the research subagent's link-walk depth, and prompt-level changes in the skills.

## What needs measuring

| Surface | What we want to know | Hard to measure without |
|---|---|---|
| **Ingest classification** | Does `engy:ingest` correctly classify durable (link → `memory/references/`) vs non-durable (snapshot → `memory/sources/`)? | A labeled corpus of URLs |
| **Distillation quality** | Does the fleeting capture core claim / what surprised / connects to / contradicts? Is it concrete or generic? | Human Likert eval against a small set |
| **Source dedup** | Same URL ingested twice → one snapshot, two distillations linked to it? | Curated repeat-input test cases |
| **Hybrid retrieval** | Given a query, do the right memories rank in the top-k? | Standard IR benchmark (BEIR-style). We treat qmd as a black box — we measure the integrated system's retrieval quality, not qmd internals. |
| **Filter mode** | JSON1 frontmatter filters return correct matches? | Custom queries against a known corpus |
| **Multi-hop / link walk** | When the answer requires combining 2+ memories, does `engy:research` walk `linkedMemories` and cite both? | Multi-hop QA benchmark |
| **Contradiction detection** | When ingest meets a source that contradicts an existing note, does the research dispatch surface it? | SUPPORTS/REFUTES labeled pairs |
| **Auto-linker** | Does the 0.75 threshold + max-5 cap produce useful links without fan-out explosion? | A seed corpus + manual relevance judgment |

## Datasets — fit assessment

| Dataset | Size | What it tests | Why it fits M7 |
|---|---|---|---|
| **BEIR / SciFact** | 1.4K claims / 5.2K abstracts, SUPPORTS / REFUTES / NEI labels | Hybrid retrieval baseline + **contradiction detection** | Small enough to ingest in minutes. REFUTES pairs are gold for the contradiction-flagging path. |
| **MuSiQue-Ans** | 25K 2-4 hop questions | **Multi-hop / link-walking** | The only dataset that meaningfully exercises `engy:research`'s `linkedMemories` graph walk. |
| **2WikiMultiHopQA** | ~12K | Multi-hop with structured + unstructured evidence | Smaller alternative to MuSiQue. |
| **BRIGHT** | 1,398 reasoning-heavy queries across 12 domains | Reasoning-intensive retrieval | Closest in *spirit* to "what do we know about X?" queries. SOTA dropped from 59 → 18 nDCG@10 vs MTEB, so it shows real hybrid-vs-vector differentiation. Aspirational, not Phase 2. |
| **FEVER** | 185K Wikipedia claims | Same SUPPORTS/REFUTES/NEI as SciFact, bigger | Use only if SciFact saturates. |
| **HotpotQA** | 113K multi-hop | Multi-hop with adversarial distractors | Backup to MuSiQue. |

**Domain gap to acknowledge:** none of these are about developer decisions / patterns / facts on codebases. A 50-100 query custom set drawn from engy's own seed corpus (M1-M7 plans + a handful of real ingested URLs + a Granola transcript) would be the highest-signal but most expensive option. Build it AFTER Phase 1 results so we know what to label.

## Tooling

| Tool | Best for | Notes |
|---|---|---|
| **BEIR library** (`pip install beir`) | Loading BEIR/SciFact/MuSiQue + nDCG@k, MRR, Recall@k | Canonical IR stack. Wraps `pytrec_eval`. Outputs comparable numbers. |
| **ir-measures** | Clean metric computation against custom labels | Useful when skipping BEIR's loader. |
| **DeepEval** | Pytest-style RAG eval with 50+ metrics; explicit MCP tool-use metrics | Useful if we later want LLM-as-judge metrics layered on top of the IR numbers. |
| **RAGAS** | LLM-as-judge metrics (faithfulness, context precision/recall, answer relevance) | Lighter than DeepEval; good for initial metric exploration. |
| **promptfoo** | Config-driven, easier to bridge from Node | Use if we want to avoid a Python harness entirely. |

**Not gating on `pnpm blt`.** Evals are an on-demand quality dial, not a regression gate — slow (qmd embedding, multi-doc ingest), non-deterministic (LLM-in-loop), and the dataset is research-licensed. Build the harnesses so they're one-command to run (`pnpm eval:scifact`, `pnpm eval:musique`, etc.), output a JSON + Markdown summary, and let humans diff runs over time. Re-run after meaningful changes (qmd version bumps, threshold tweaks, prompt edits to ingest/research) — not on every commit.

**Production-target benchmarks the field uses** (useful for setting M7 gates):
- Context precision > 0.8
- Faithfulness > 0.8
- Answer relevance > 0.75

**Hybrid retrieval headroom on BEIR:** hybrid (BM25 + dense) typically beats pure BM25 by **2-5 nDCG points**, especially on out-of-domain queries. That's our Phase 2 directional check.

## Corpus shape requirement (load-bearing)

**The retrieval system is designed for Zettelkasten-shaped content, not raw document dumps.** Every memory is expected to be:

- **Atomic** — one core claim per file, ~100-300 words
- **Typed** — `subtype: decision | pattern | fact | convention | insight`
- **Tagged** — `tags: [...]` for filter-mode retrieval (themes also indexed but not currently filterable)
- **Linked** — `linkedMemories: [...]` to form a graph the research subagent can walk
- **Sourced** — `sources: [...]` pointing back to the originating document(s)

**Implication for every phase below:** evaluating retrieval on a corpus of bulk-written raw docs (full milestone plans, full CLAUDE.md files, full SciFact abstracts as one file each) measures the **wrong thing**. Raw long documents accumulate broad vocabulary that wins BM25 + rerank by sheer surface area, even when the answer is in a short focused doc. **Confirmed empirically** in the seeding sprint (2026-05): a 23-doc raw-dump corpus had hybrid retrieval miss CLAUDE.md content for queries whose literal answer lived there ("pre-commit checks", "WebSockets server↔daemon"). Replacing with 20 hand-distilled zettels surfaced the answers.

**What this means in practice:**

1. **Don't bulk-write source documents as memories.** Either run them through `/engy:ingest` (slow but correct — produces fleeting distillations + reference pointers), or hand-author zettels for eval.
2. **Public IR benchmarks (SciFact, MuSiQue) need a corpus-transformation step.** Each abstract/paragraph should become a small zettel with frontmatter (title, type, tags, linked siblings) — not a raw doc. Without this, you're benchmarking BM25 length-normalization, not engy's retrieval design.
3. **Phase 1 is the right shape today** (it uses `/engy:ingest`). Phases 2-3 currently bypass ingest with bulk-write — they need an added "corpus transformation" step before any retrieval numbers are meaningful.
4. **A/B against the raw-dump corpus** is itself a useful eval: same query, raw-dump corpus vs zettel corpus, measure the lift. Quantifies the value of distillation.

## Proposed phasing

### Phase 1 — Ingestion calibration (custom seed corpus)

**Goal:** catch ingestion regressions and validate classification + distillation quality before throwing public datasets at it.

**Inputs:**
- 30-50 docs hand-labeled `durable | snapshot`
  - Mix: 5-10 RFCs/spec URLs (durable), 5-10 Slack/transcript/article URLs (snapshot), 5-10 internal repo paths (durable with SHA), 5-10 raw text pastes (snapshot)
- 15-20 "what do we know about X" queries with expected memory paths

**Procedure:**
1. Reset `.dev-engy/`, create a fresh workspace
2. Run `/engy:ingest <each input>` sequentially
3. Capture: classification verdict, written file path, distillation content, git commit message
4. Manual scoring:
   - **Classification accuracy** (binary: correct/incorrect against the pre-registered labels — do NOT re-decide ambiguous cases at scoring time)
   - **Distillation Likert** (1-5: does each of the 4 parts carry signal?). Single-rater is high variance; pre-register a per-score rubric. If two raters are available, also compute Cohen's κ.
   - **Source dedup** (run a subset twice; verify single snapshot file)

**Pass criteria:** classification ≥ 90%, mean distillation Likert ≥ 3.5, dedup 100%.

**Effort:** ~3-4 hours to build the corpus + ~1 hour to run + ~1 hour to score. Mostly one-time setup; the corpus is reusable.

### Phase 2 — Retrieval baseline against SciFact

**Goal:** establish a canonical retrieval number for `search.query` that we can track over time as we change skills, schemas, or auto-linker. We're not benchmarking qmd as a component — we treat the whole search stack as a black box and only ask "do the right docs come back?".

**Corpus-shape prerequisite (see "Corpus shape requirement" section above):** SciFact abstracts cannot be bulk-written verbatim and called memories — that mismatches what the system is designed to index. Each abstract must be transformed into a zettel-shaped permanent memory with frontmatter:
- `subtype: fact` (or `insight` for claims with novelty)
- `title:` the abstract's title
- `tags:` 3-5 derived keywords (from the abstract's domain — biomedical/clinical/etc.)
- `sources: [scifact:<doc_id>]`
- `linkedMemories:` populated by the auto-linker after first reindex (the SciFact graph has no canonical link structure; this measures whether the auto-linker can discover one)
- Body: the abstract text

Without this transformation, Phase 2 measures "does qmd beat BM25 on raw abstracts" — a question about qmd, not engy.

**Procedure:**
1. Transform SciFact's 5,183 abstracts into zettels per the shape above. Write under `memory/facts/<scifact-id>.md`.
2. Bulk-write via `dir.write` — note that this still bypasses the `/engy:ingest` skill (no fleeting-memory step, no research dispatch). That's intentional for Phase 2: we're measuring retrieval, not ingest. The transformation above gives the retrieval layer fair input.
3. Trigger one full `reindex`; wait for the embed pass to complete (note the duration as a perf datapoint, not a pass/fail criterion)
4. Iterate over SciFact's 300 dev queries; call `search.query({ query, limit: 10 })` for each
5. Convert response paths back to SciFact doc IDs; compute nDCG@10, MRR, Recall@10 via `ir-measures`

**Pass criteria:**
- nDCG@10 ≥ 0.65 (BEIR public SciFact hybrid retrievers cluster in 0.65-0.72; this is our integration-level target, not a qmd-internals claim)
- p95 query latency < 2s (after warm-up; first hybrid query can be 5-6 min per validation findings)

**Effort:** ~10-15h realistically — Python harness (~150 LOC) + BEIR JSONL → markdown conversion + tRPC HTTP adapter + embed warm-up handling + scorer + run validation. Once built, every code change can be evaluated by re-running this harness.

### Phase 3 — Multi-hop link walking against MuSiQue-Ans (2-hop subset)

**Goal:** test the only path that exercises `linkedMemories` walking — the `engy:research` subagent's graph traversal.

**Procedure:**
1. Take MuSiQue-Ans 2-hop subset (~1K questions)
2. Build a **shared corpus** across all questions: union of every question's 2 supporting paragraphs **plus** its distractor paragraphs (~10K+ docs total). Distractors are the whole point of MuSiQue — without them, the 2-doc lookup is trivial and Recall@2 numbers are meaningless.
3. For each question, populate `linkedMemories: [<other supporting doc id>]` on the 2 gold docs only
4. Drive `engy:research` subagent over the 1K questions against the shared corpus
5. Score: does the returned digest cite BOTH gold docs? (Recall@2 against the gold doc set per question)
6. Compare to a baseline run against the same shared corpus but with `linkedMemories` empty on every doc — does single-hop hybrid still find both?

**Pass criteria:**
- With links populated: Recall@2 ≥ 0.7
- Lift over no-links baseline ≥ 0.1 (otherwise link walking isn't adding signal)

**Effort:** ~200 LOC Node harness (MuSiQue loader + corpus assembler with distractors + Claude Code session driver + scorer). Higher effort because skill round-trips need a real Claude session.

### Phase 4 — Contradiction detection against SciFact REFUTES

**Goal:** test the contradiction-surfacing path that runs across `engy:ingest` step 3 (distillation "Contradicts" field) + step 4 (research dispatch over related memories). There is no dedicated "step 5 contradiction classifier" in the current implementation — Phase 4 measures the integrated signal.

**Prerequisite:** the ingest output today surfaces contradictions in free-text inside the research subagent's distillation. Before scoring, add a structured `contradictionFlags: <memory-id>[]` field to the ingest commit/output so we have a binary signal per memory pair to score against. Otherwise we're regex-matching prose.

**Procedure:**
1. Filter SciFact to claims labeled REFUTES with a single abstract evidence (~250 pairs)
2. For each pair:
   - Ingest the abstract first as a snapshot
   - Promote it to a permanent memory (so it's a "prior position")
   - Ingest the REFUTING claim as a second snapshot
   - Capture the structured `contradictionFlags` from the second ingest's output
3. Compute binary precision/recall on the "flagged a contradiction with the prior memory" output

**Pass criteria:**
- Recall ≥ 0.5 (catch half of real contradictions — generous initial bar)
- Precision ≥ 0.7 (don't cry wolf more than 30% of the time)

**Effort:** ~150 LOC Node harness, builds on Phase 1 corpus tooling.

### Phase 5 — Custom domain corpus (optional, after Phase 1-2 land)

Build a 50-100 query/relevance-pair corpus drawn from engy's own ecosystem. Hand-label relevance for each query. Re-run Phase 2's harness against this domain-matched set. Direction: bridges the gap between SciFact's scientific-abstract domain and engy's actual decisions/patterns/facts domain.

**Corpus shape:** the source material is engy's M1-M9 plans + a few real URLs + a Granola transcript — but these must NOT be ingested as raw documents (see "Corpus shape requirement"). Two options:

1. **Run each through `/engy:ingest`** — slowest but truthful: tests the actual user-facing path. ~30 docs × ~2-5 minutes/ingest = 1-2.5h just to seed.
2. **Hand-distill into zettels** — faster: read each source, write 1-3 atomic zettels per source with proper frontmatter (subtype, tags, linkedMemories, sources). ~30 sources × 5-10 min/source = 2.5-5h. Sidesteps the slow ingest path but loses fidelity to what real users would get.

Recommend option 1 once `/engy:ingest` performance is tolerable, option 2 in the interim.

## Implementation stack

- **Python harness** (~150 LOC) using `beir` + `ir-measures` for Phases 2-3.
  - Calls engy's tRPC `search.query` endpoint directly via HTTP.
  - Outputs JSON results + Markdown summary per run for diffing across runs.
  - Lives at `eval/scifact_runner.py` or similar — outside the main pnpm tree.
- **Node harness** (~200 LOC) for Phases 1, 3, 4.
  - Drives Claude Code skills via the worktree's MCP session.
  - Needed because ingest/research/review skills only run through a Claude Code agent.
  - Lives at `eval/node-driver/` with its own package.json.
- **One-command rerun** for every phase.
  - Each harness exposes a single `pnpm eval:<phase>` (or `make eval-<phase>`) entry point.
  - Outputs go to `eval/results/<YYYY-MM-DD-HHmm>/` as JSON + Markdown summary so diffs across runs are easy.
  - No CI hookup — evals are too slow and too non-deterministic to gate commits. Humans rerun after meaningful changes (qmd bumps, threshold tweaks, skill prompt edits) and eyeball the diff.

## Eval corpus branch

Long-lived branch `m7-eval-corpus` (or similar) holding the prepared inputs so every rerun starts from the same warmed state — no waiting on dataset downloads, no re-converting BEIR JSONL to markdown, no manual relabeling between runs.

**Layout:**

```
eval/
  corpus/
    scifact/
      references/    5183 *.md files, one per SciFact abstract (uses the existing memory/references/ convention)
      claims.jsonl   300 dev queries + relevance judgments
    musique/
      memories/      multi-hop supporting docs as memories
      links.json     gold linkedMemories pairings
      questions.jsonl
    custom/
      durability/    Phase 1 hand-labeled URL set
      queries.jsonl  "what do we know about X" + expected paths
  golden/
    <dataset>/<query-id>.json   per-query relevance labels
  snapshots/
    scifact-warmed.tar.zst      optional pre-embedded .qmd/qmd.db
  README.md                     how to reseed + run
```

**Why a branch, not main:**
- Pre-warmed qmd snapshots can be GB-scale — bad fit for the main repo
- Raw dataset files (BEIR JSONL, MuSiQue dumps) bloat history needlessly even though their licenses (SciFact CC BY-NC 2.0, MuSiQue CC BY 4.0, HotpotQA CC BY-SA 4.0) permit redistribution
- Lets us rebase / reset without disturbing the main branch's commit graph

**Procedure for each eval rerun:**
1. Check out `m7-eval-corpus` (worktree it for parallel work)
2. Either: bulk-write `eval/corpus/<dataset>/` into a fresh `.dev-engy/` workspace and reindex, OR: untar the matching snapshot for a warm start
3. Run `pnpm eval:<phase>` against the running server
4. Results land in `eval/results/<timestamp>/`; commit them to the branch for historical comparison

**Maintenance:** corpus files are reproducible from upstream sources, so the branch can be rebuilt from scratch via `pnpm eval:rebuild-corpus` if it ever drifts. Snapshots are optional — they're a perf optimization, not a correctness input.

**Concrete first deliverable:** a `m7-eval-corpus` branch with just `eval/corpus/scifact/` + `eval/golden/scifact/` + the Phase 2 Python harness checked in. Everything else accretes as we add phases.

## Sequencing rationale

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5.

- Phase 1 first because regressions in ingest classification or distillation invalidate everything downstream.
- Phase 2 second because if retrieval is broken, ingest quality doesn't matter — we won't find anything we ingested. SciFact is the cheapest defensible signal.
- Phase 3 third because link walking is M7's most differentiated feature and the lit shows it's the hardest path to get right.
- Phase 4 fourth because contradiction detection layers on top of Phases 1-3 (needs ingest + retrieval working).
- Phase 5 last because building the custom corpus is the most expensive step and benefits from knowing what's already working.

## Open questions to resolve before starting

1. **Embedding model download.** Phase 2 will trigger qmd's GGUF download on first run (multi-GB, multi-minute). Plan for this in the harness — either pre-warm or accept a long cold-start cost.
2. **Workspace-relative paths in eval mode.** Should the harness ingest into a dedicated workspace, or use a fresh `.dev-engy/` per run? Fresh is more reproducible but slower.
3. **Phase 4 contradiction instrumentation.** Adding a structured `contradictionFlags` field to ingest output is a hard prerequisite for Phase 4 scoring. Confirm scope and land it before Phase 4 work starts.

## Cost & timeline estimate (rough)

| Phase | Build | Run | Score | Total |
|---|---|---|---|---|
| 1 — Ingestion calibration | 3-4h corpus + harness | 1h | 1h | ~6h |
| 2 — SciFact retrieval | 8-12h Python harness + BEIR conversion + tRPC adapter + warm-up | 30min ingest + 30min queries | 30min | ~10-15h |
| 3 — MuSiQue link-walk | 6-8h Node harness | 2-4h skill runs | 1h | ~10h |
| 4 — Contradiction | 3-4h harness (reuses Phase 1+3 tooling) | 1-2h | 30min | ~5h |
| 5 — Custom corpus | 8-12h corpus building | 1h | 2h | ~12h |
| **Total** | | | | **~43-48h** |

Phase 1 + 2 alone (~16-21h) gives the highest signal for the lowest cost. Recommend running them as a tight sprint before deciding whether to do 3-5.

## Score history — calibration corpus

Informal pre-Phase-1 calibration runs against a 134-zettel corpus seeded by 4 independent subagents from engy's own M1–M9 plans + spec + context docs. 15-question grading rubric (0/1/2; synthesis-aware): 5 conceptual "why" + 5 factual "where/what" + 3 bare identifier + 2 cross-cutting "X and Y".

| Run | Method | Score | What changed |
|---|---|---|---|
| v1 | independent validator, raw `search.query` | 26/30 | baseline |
| v2 | independent validator, simulated playbook (no link walk) | 27/30 | + intent tokens |
| v3 | "real-agent" attempt (agent was not registered, validator simulated) | 26/30 | flat — same protocol as v1/v2 |
| v4 | subtype-affinity reranking + MCP path fixes | 28/30 | server-side reranking flipped Q6/Q11/Q13 |
| v5 | + near-tie disambiguation guidance | 28/30 | recovered Q4 (tied decisions); regressed elsewhere by judgment |
| v6 | manual playbook applying full Wave A/B/C rules (BFS depth-2 + dedup + confidence tags) | 29/30 | BFS rescued multi-hop Q14; dedup fixed Q11; Q13 still partial |
| **v7** | **first true real-agent run** (`engy:research` registered after fixing frontmatter) | **30/30** | research-only policy fixed Q12 (no longer invokes action tools); Q13 caught as catalogue rather than definition |

Reports archived at `/tmp/validation-report-v{N}-*.md`. The v7 run is the first measurement against the actual production agent — prior runs (including v3) were manual playbook executions because the agent failed to register due to MCP tool names in its frontmatter (fixed in commits `47760e0` + `8982cc8`).

**What this calibration teaches us before formal Phase 1–5:**
- Subtype-affinity reranking and BFS link-walking both moved the needle on this corpus. Worth keeping in the production agent.
- Synthesis-aware grading (digest quality, not top-1) is necessary — top-1 retrieval alone doesn't reflect what the user sees.
- The research-only policy (Q12 fix) is a durable agent-behavior rule independent of any specific dataset. Apply across other action-named questions in formal eval sets.
- An unregistered agent is invisible to evaluators — make sure the registered agent matches the docs/intent of the eval before running formal benchmarks.

## References

- [BEIR Benchmark — GitHub](https://github.com/beir-cellar/beir)
- [BEIR Leaderboard 2025/2026](https://app.ailog.fr/en/blog/news/beir-benchmark-update)
- [BRIGHT: A Realistic and Challenging Benchmark](https://brightbenchmark.github.io/)
- [SciFact — Allen AI](https://github.com/allenai/scifact)
- [HotpotQA](https://hotpotqa.github.io/)
- [MuSiQue — Multihop Questions via Single-hop Question Composition](https://aclanthology.org/2022.tacl-1.31.pdf)
- [RAGAS docs](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/)
- [DeepEval — Confident AI](https://deepeval.com/docs/metrics-ragas)
- [RAG Evaluation Frameworks 2026 Comparison](https://atlan.com/know/llm-evaluation-frameworks-compared/)
- [LongBench v2](https://aclanthology.org/2025.acl-long.183.pdf)
- [HELMET long-context benchmark](https://openreview.net/forum?id=293V3bJbmE)
