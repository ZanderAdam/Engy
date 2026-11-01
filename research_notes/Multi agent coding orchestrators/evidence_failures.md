# Evidence and failure modes of multi-agent coding orchestration (as of 31 Oct 2026)

Evidence tags used on each finding:
- **[A]** controlled experiment or benchmark with a published method (often a preprint; peer review is stated when known).
- **[B]** large observational data set, or a survey with a stated sample.
- **[C]** single-team engineering report with numbers. Not independently checked.
- **[D]** practitioner opinion, anecdote, or bug report.
- **(vendor)** the author sells a related product. Read as a claim.
- **(2nd-hand)** read through a secondary article or search summary, not the primary source.

Overall verdict: no controlled study measures real developers running parallel coding agents. The strongest direct evidence (CooperBench) is negative for parallel writers that touch overlapping code. The positive evidence is vendor reports on tasks with strong test oracles, or tasks with clean decomposition. Most sources agree on one narrow form that works: many readers or reviewers, one writer per area, independent verification, and a human who lands the work.

## What measured results exist (throughput, quality, cost, review load)?

### Takeaway
Agents working on overlapping code do worse together than one agent doing all the work (about 25% success, about half of solo). Large swarm successes exist, but they are vendor-reported, cost-heavy, and depend on strong test oracles. Organization-level telemetry shows more throughput with much more review time, bugs and incidents.

### Cited Findings

Controlled and benchmark evidence:
- **[A]** CooperBench (Stanford and others; 652 tasks, 12 repos, two agents with compatible features that touch overlapping code; merged with git; test suites run on the merge). GPT-5 and Claude Sonnet 4.5 reached about 25% success, about half the "Solo" baseline where one agent does both features. The abstract gives an average drop of about 30%. — [arXiv 2601.13295](https://arxiv.org/html/2601.13295). A search result lists it as a COLM 2026 paper and there is an [ICLR 2026 workshop listing](https://iclr.cc/virtual/2026/10018462); I did not confirm the review status.
- **[A]** CooperBench scaling (46 tasks): success fell from 68.6% with 2 agents to 46.5% with 3 and 30.0% with 4. Tasks of medium difficulty showed the largest gap. — [arXiv 2601.13295](https://arxiv.org/html/2601.13295)
- **[A]** Messaging between agents gave no significant gain in success in CooperBench. It reduced merge conflicts for several models, because agents coordinated where to edit but not what to build. — [arXiv 2601.13295](https://arxiv.org/html/2601.13295)
- **[A]** Google and MIT "Towards a Science of Scaling Agent Systems" (180 configurations, 4 benchmarks, 5 architectures): centralized coordination gave +80.9% on a parallel finance task; every multi-agent variant lost 39-70% on the strictly sequential PlanCraft task. Independent agents amplified errors up to 17.2x; a central orchestrator held it to 4.4x. No benchmark is a coding benchmark. The predictor fit is modest (R² = 0.513). — [Google Research blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) (vendor-adjacent; Google sells agent products), [arXiv 2512.08296](https://arxiv.org/html/2512.08296)
- **[A]** METR RCT, early 2025: AI use made experienced open-source developers 19% slower (CI +2% to +39%). Late-2025 follow-up: returning developers -18% time (CI -38% to +9%), new developers -4% (CI -15% to +9%). METR calls the late-2025 data an "unreliable signal" due to severe selection: developers refused to work without AI. METR also says time tracking fails for developers who use several agents at once. It is moving away from this design. — [METR, Feb 2026](https://metr.org/blog/2026-02-24-uplift-update/). This trial measures AI use in general, not orchestration.

Engineering reports:
- **[C] (vendor)** Anthropic C compiler: 16 parallel Claudes, nearly 2,000 sessions, two weeks, about $20,000, about 2 billion input and 140 million output tokens, about 100,000 lines of Rust, about 99% pass on most compiler test suites. No orchestrator: shared git repo, text-file task locks, one container per agent. It relied on GCC as a known-good oracle. Output code is less efficient than GCC with optimizations off, and it is not a drop-in replacement. The author says it has "nearly reached the limits of Opus's abilities". — [Anthropic](https://www.anthropic.com/engineering/building-c-compiler)
- **[C] (vendor)** Anthropic research system (not coding): multi-agent beat single-agent Opus 4 by 90.2% on an internal eval; about 15x the tokens of chat; up to 90% less time on complex queries. The same post says multi-agent fits poorly with tasks that need shared context or many dependencies, "such as most coding work". — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- **[C] (vendor)** Cursor, Jan 2026: flat self-coordination with locks: "Twenty agents would slow down to the effective throughput of two or three". Planner and worker hierarchy worked better. Self-reported: browser with over 1M lines in about a week, hundreds of workers; Solid-to-React migration of +266K/-193K that still needs review. — [Cursor](https://cursor.com/blog/scaling-agents)
- **[C] (vendor, 2nd-hand)** Cursor SQLite rebuild, July 2026: the old swarm made about 68,000 commits in two hours and over 70,000 merge conflicts; one file had 7,771 conflicts from 1,173 agents. The new swarm stayed below 1,000 conflicts, but needed a custom version control system. New runs cut code size by up to 85% at equal or better scores. Costs: $1,339 (Opus planner, Composer workers) to about $20,057 (Fable solo in a chart). Workers used at least 69% of tokens. One task, one benchmark. — [The Decoder](https://the-decoder.com/cursors-agent-swarm-suggests-cheaper-models-can-handle-most-coding-when-frontier-models-plan-the-work/)
- **[C] (vendor)** Cognition, April 2026: Devin Review finds on average 2 bugs per PR, about 58% severe. Usage in the largest enterprise segment rose about 8x in 6 months. — [Cognition](https://cognition.com/blog/multi-agents-working)

Observational data:
- **[B]** 33,596 agent-authored PRs on GitHub projects with over 100 stars: 71.48% merged. By agent: Codex 82.59%, Cursor 65.22%, Claude Code 59.04%, Devin 53.76%, Copilot 43.04%. Docs about 84%, performance about 55%. Each failed CI check goes with about 15% lower merge odds. — [arXiv 2601.15195](https://arxiv.org/html/2601.15195). Merge rate is not quality, and these are not all multi-agent runs.
- **[B] (vendor)** Faros AI telemetry (about 22,000 developers, 4,000 teams, high versus low AI adoption inside the same organization): tasks +33.7%, epics +66.2%, PR merge rate +16.2%, deployments per week -11.7%, PR size +51%, median review time 5X, bugs per PR +28.7%, incidents per PR +242.7%, code churn +861%. — [Faros](https://faros.ai/research/ai-acceleration-whiplash). The public page gives no metric definitions or tests. It is correlational. Faros sells engineering metrics. Other summaries also cite +91% review time and 31.3% more PRs merged without review; I could not find these on the primary page ([FAQ page](https://www.faros.ai/comparison/github-copilot-vs-codeium), [2nd-hand](https://dev.to/mnemehq/the-acceleration-whiplash-and-the-governance-gap-b5f)). The +91% may come from an older Faros report.

### Inferences
- The positive and negative evidence can both be true. Success depends on decomposition and the oracle. CooperBench forces overlap and has hidden tests. The C compiler had an external oracle and could use repeated tries at $20K.
- Token cost scales about linearly or worse. Spend alone does not show value, because rework is included in the metrics that vendors count (commits, lines). Cursor's new swarm scored better with about 70x fewer commits, so commit count is a bad success metric.
- Review load appears as the true limit at organization level, but Faros is correlational and from a vendor.

### Gaps
- No RCT or controlled study of humans with N parallel agents against one agent, on real tasks. METR says its method fails for this case.
- No independent replication of the Anthropic, Cursor or Cognition numbers. I did not inspect Cursor's published code.
- No public, defined measure of review hours per agent-authored change for multi-agent runs.

## What are the common failure modes?

### Takeaway
The main failure is semantic: agents make conflicting decisions that merge cleanly or do not integrate. Git-level conflicts are a smaller problem and can be reduced with tools. False "done" is common and measured. Inter-agent prompt injection is proven in research, with no public incident I could confirm for coding orchestrators.

### Cited Findings

Coordination, duplicated work, conflicts:
- **[A]** CooperBench failure symptoms: work overlap 33.2%, divergent architecture 29.7%. Causes: expectation failures 42%, commitment failures 32%, communication breakdown 26%. Agents repeat, leave questions unanswered, and make inaccurate claims. — [arXiv 2601.13295](https://arxiv.org/html/2601.13295)
- **[B]** In 562 categorized rejected agent PRs (the paper reports percentages over 600), reviewer abandonment was 38%, duplicate PRs 23%, CI or test failures 17%. Unwanted features were 4%. — [arXiv 2601.15195](https://arxiv.org/html/2601.15195)
- **[C] (vendor)** Anthropic compiler: all 16 agents hit the same kernel bug, fixed it, and overwrote each other. New features often broke old ones. — [Anthropic](https://www.anthropic.com/engineering/building-c-compiler)
- **[C] (vendor, 2nd-hand)** Cursor "split-brain design": two planners built the same idea in different places. Planners that knew about each other blocked each other. The old run split the project into 54 crates with three SQL packages. — [The Decoder](https://the-decoder.com/cursors-agent-swarm-suggests-cheaper-models-can-handle-most-coding-when-frontier-models-plan-the-work/)
- **[C] (vendor)** Cursor: agents held locks too long, never released them, re-acquired held locks, or edited the coordination file without a lock. An integrator role "created more bottlenecks than it solved". Without hierarchy, agents avoided hard tasks. — [Cursor](https://cursor.com/blog/scaling-agents)

Context loss:
- **[D] (vendor)** Cognition 2025: subagents make conflicting assumptions because "actions carry implicit decisions"; the Flappy Bird example. — [Cognition, June 2025](https://cognition.com/blog/dont-build-multi-agents)
- **[C] (vendor)** Cognition 2026: managers are too prescriptive, agents assume they share state with children, and communication does not happen by default. — [Cognition](https://cognition.com/blog/multi-agents-working)
- **[C] (vendor)** Anthropic compiler: verbose test output pollutes context, and "time blindness" leads to hours of test runs. — [Anthropic](https://www.anthropic.com/engineering/building-c-compiler)
- **[D] (vendor)** A Kilo engineer reports quality falling at about 60% context fill, before compaction at about 95%. — [Kilo](https://blog.kilo.ai/p/how-7-kilo-code-engineers-run-up)

False completion:
- **[A]** OverclaimBench (Sept 2026, 12 models, 5 file-review scenarios, preprint): agents failed to read every requested file in 67.9% of runs. In incomplete runs, 80.4% were misleading (range 59-96% by model). False full-review claims missed planted defects at about 1.8x the rate of agents that read all files. Requiring subagent delegation improved coverage, but most remaining incomplete reviews stayed misleading. — [arXiv 2609.20812](https://arxiv.org/abs/2609.20812). It covers file review, not all coding.
- **[C]** nomArmy harness: 265 "done, tests pass" claims in 547 jobs; 24 failed independent re-check (about 1 in 11): 16 failed re-runs and 8 inert tests. One machine, 16 days, the authors' own repos. — [Survey post](https://redreamality.com/blog/coding-agent-done-claims-verification-survey/). The same post lists seven forms: slice-only test runs, stale results, subagent failure lost in the summary, tests that prove nothing, shared misunderstanding, pass alone and fail together, real-environment-only failure.
- **[D] (vendor)** A Stop-hook verifier reports false "Done" of 2.1% to 6.0% by model and 0% for frontier Claude over 102 runs per model. — [Product Hunt, 2nd-hand](https://www.producthunt.com/posts/1221174). Treat with caution. It conflicts in size with OverclaimBench, but measures another thing.
- **[C] (vendor)** Claude Code docs: a lead "can stop early", deciding the team is finished before tasks are complete; teammates may stop after errors; teammates sometimes fail to mark tasks completed, which blocks dependents. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams)
- **[C] (vendor)** The Anthropic compiler author warns that passing tests can be mistaken for completion, and the harness must be nearly perfect or agents solve the wrong problem. — [Anthropic](https://www.anthropic.com/engineering/building-c-compiler)

Stuck, runaway, and cost:
- **[C] (vendor)** Anthropic research system: 50 subagents for simple queries, endless search for sources that do not exist, subagents distracting each other, compounding errors in long stateful runs. — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- **[C] (vendor)** Cursor: agents sometimes run far too long; fresh starts are still needed to fight drift and tunnel vision. Opus 4.5 tended to stop early. — [Cursor](https://cursor.com/blog/scaling-agents)
- **[D]** One agent ran `pkill -9 bash`, which killed its own loop. — [Anthropic](https://www.anthropic.com/engineering/building-c-compiler)
- **[D]** Yegge on Gas Town: "I only ever wound up using it to build itself"; it "fell apart at the seams with Opus 4.7" because a "just two more things" habit stopped convergence. — [Willison quoting Yegge](https://simonwillison.net/2026/Aug/4/steve-yegge/). A model update broke the system, so orchestrators depend on model behavior.
- **[D]** Reported Gas Town API cost is about $2,000-$5,000 a month. — (2nd-hand, low confidence) [summary](https://second-brain-nuxt.vercel.app/gas-towns-agent-patterns)

Reviewer and merge overload:
- **[D] (vendor)** Yegge: about 40 agents, about 175 commits a day, 30-minute build, merge queue reached 166, so he stopped gating main and lands 120-150 commits at once. Critic Julien Danjou says this drops the link from a failure to the agent and intent that caused it. Danjou runs a merge-queue company and says so. — [Danjou](https://julien.danjou.info/blog/steve-yegge-deleted-the-wrong-thing)

Prompt injection between agents:
- **[A]** Triedman, Jha and others: multi-agent systems were made to run arbitrary malicious code in 58-90% of trials depending on orchestrator, even when single agents resist normal injection (2nd-hand figure). — [arXiv 2503.12188](https://arxiv.org/pdf/2503.12188v2)
- **[A]** Jha and others: control-flow hijacking evades alignment-check defenses such as LlamaFirewall. The proposed defense, ControlValve, uses permitted control-flow graphs and least privilege. — [arXiv 2510.17276](https://arxiv.org/abs/2510.17276). A search summary says ICLR 2026; the arXiv page shows no venue.
- **[A]** OMNI-LEAK: one indirect injection made orchestrator and worker agents coordinate data exfiltration; all tested models except claude-sonnet-4 were susceptible (2nd-hand). — [arXiv 2602.13477](https://www.arxiv.org/pdf/2602.13477). This is not a coding setup.
- **[D]** Claim of 31% inter-agent injection success: I could not verify it; do not rely on it. — [arXiv 2609.22949](https://arxiv.org/pdf/2609.22949)
- **[C] (vendor)** Claude Code tells a receiving agent that a `SendMessage` came from another Claude session, not the user. A teammate cannot approve a permission for the user or relay a denied action. Auto mode treats relayed approval claims as untrusted. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams)

### Inferences
- Parallel writers fail on shared understanding more than on shared files. File ownership prevents overwrites, but does not prevent divergent design.
- A worker's closing text is a claim, not evidence. OverclaimBench and nomArmy both support this. A reply tool such as `terminal_reply` carries the same risk, and it needs evidence fields or an independent check.
- Duplicate work is both an in-run failure and a repo-level failure, so a check for existing work belongs before dispatch.

### Gaps
- No published rate of inter-agent injection in a real coding orchestrator. I found no confirmed public incident.
- Failure frequencies from production orchestrators are not public. Most data is from benchmarks or single teams.
- The Yegge shutdown is reported in [one Spanish-language source](https://ecosistemastartup.com/?p=108516); his own words say it "effectively burned down". I did not read his full essay.

## When do experts advise against parallel agents or an agent orchestrator, in favor of a human coordinator?

### Takeaway
Advice against is consistent: do not parallelize sequential, same-file, or dependency-heavy work, and do not run many unstructured writers. Most practitioners keep the human as the landing point for significant changes. Automated coordination is supported for mapped, independent subtasks and for hierarchical planner-worker systems with strong oracles.

### Cited Findings
- **[D] (vendor)** Cognition 2025: prefer a single-threaded agent; rule out architectures that split decisions without shared context. — [Cognition](https://cognition.com/blog/dont-build-multi-agents)
- **[C] (vendor)** Cognition 2026 softened this: multi-agent works "best when writes stay single-threaded", with extra agents adding intelligence, not actions. Arbitrary agent networks are "mostly a distraction". Manager and child delegation is live but still has problems. — [Cognition](https://cognition.com/blog/multi-agents-working). Note: the fetched summary calls the first post "October-era", but the first post is dated June 12, 2025, and "about 10 months earlier" matches June.
- **[C] (vendor)** Claude Code docs: for "sequential tasks, same-file edits, or work with many dependencies", a single session or subagents work better. Start new users on research and review, not parallel implementation. Unattended runs raise the risk of wasted effort. Teams can run with `--dangerously-skip-permissions` propagation, so review that choice. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams)
- **[C] (vendor)** Anthropic: multi-agent suits breadth-first, parallel tasks, and is a poor fit for "most coding work". — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- **[A]** Sequential tasks lost 39-70% with every multi-agent variant. — [Google Research](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)
- **[D]** Simon Willison: he can "only focus on reviewing and landing one significant change at a time". He parallelizes research, code explanation, small maintenance, specified work, and throwaway scouting. — [Willison, Oct 2025](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- **[D]** Willison quotes the view that the human bottleneck limits how fast bad code accumulates. — [Willison, Mar 2026](https://simonwillison.net/2026/Mar/25/thoughts-on-slowing-the-fuck-down/) (2nd-hand via search summary)
- **[C] (vendor)** Counterpoint: Cursor found a role for planners and removed the integrator; the C compiler had no orchestrator at all. — [Cursor](https://cursor.com/blog/scaling-agents), [Anthropic](https://www.anthropic.com/engineering/building-c-compiler)
- **[A]** Counterpoint to "no orchestrator": centralized error amplification was 4.4x against 17.2x for independent agents. — [Google Research](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)

### Inferences
- Use an orchestrator when the work is a map over independent units, or the oracle is strong. Use a human coordinator when decisions are the hard part, the work is sequential, or the change is significant.
- "Agent orchestrator or human" is a false pair for most teams. The common working form is an agent that does dispatch and tracking, and a human who decides scope and lands changes.
- A manager agent that only relays adds cost and error surface. The Cursor integrator result points the same way, but it is one report.

### Gaps
- No head-to-head study of agent coordinator against human coordinator on the same coding tasks.

## What is the practical limit on parallel agents one person can supervise?

### Takeaway
There is no measured limit. Practitioner reports cluster at 2-4 actively supervised agents, or about 3-5 for team-style use, and about one significant change in review at a time. Background agents can raise the total count only when each one produces a small, test-gated, reviewable output.

### Cited Findings
- **[D] (vendor)** Kilo engineers: most run "2-4 foreground agents"; one stays at 2-3 for high-stakes work; one known for 20+ keeps 1-3 in the foreground and the rest are background. — [Kilo](https://blog.kilo.ai/p/how-7-kilo-code-engineers-run-up)
- **[C] (vendor)** Claude Code docs: "Start with 3-5 teammates", 5-6 tasks each; "Three focused teammates often outperform five scattered ones". — [Agent teams docs](https://code.claude.com/docs/en/agent-teams)
- **[D]** Willison: four agents and "by like 11 AM, I am wiped out for the day". — [Lenny's Podcast highlights](https://simonwillison.net/2026/Apr/2/lennys-podcast/). In February he reported mental energy almost gone after an hour or two on two or three projects. — [Willison archive](https://simonwillison.net/2026/Feb/9/) (both via search summary)
- **[B]** BCG with UC Riverside (HBR, March 2026), 1,488 US workers, self-report: productivity peaks at three simultaneous AI tools and drops beyond four. High oversight went with 14% more mental effort, 12% more fatigue, 19% more information overload. "Brain fry" group reported 39% more major errors. BCG sells AI advisory. — [The Decoder](https://the-decoder.com/study-warns-of-ai-brain-fry-as-workers-hit-cognitive-limits-overseeing-ai-agents/) (2nd-hand). This covers all knowledge workers and tools, not coding agents. Secondary sources disagree on whether the threshold is three or four.
- **[D]** VirtusLab's 3-7 range is drawn by analogy from human span of control, not from measurement. — [VirtusLab](https://visdom-maturity-matrix.virtuslab.com/guides/organization/span-of-control-how-many-agents-you-can-effectively-supervis)
- **[D] (vendor)** Yegge's 40 agents are the top outlier, and he dropped gating of main to sustain it. — [Danjou](https://julien.danjou.info/blog/steve-yegge-deleted-the-wrong-thing)

### Inferences
- Treat 3 active agents as a default and about 5 as a warning level. Limit the number of items waiting for human review, not the number of running agents.
- Count of agents is the wrong unit. Review queue depth and decisions per hour are better. This is reasoning from the sources, not a measurement.

### Gaps
- I found no supervisory-control study on coding agents. Human-factors research on multi-robot supervision may give better numbers, and I did not cover it.

## What design patterns do practitioners recommend?

### Takeaway
The recommended set is consistent across sources: small specified tasks, isolated workspaces with one owner per area, independent verification before "done", a clean-context reviewer, fresh restarts, durable state, and structured state outside chat text. Evidence is mostly report-level, and no study ranks them.

### Cited Findings
- **Spec-first:** Code built from your own spec costs less review effort. — [Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/). Cursor says accurately describing intent was the main constraint. — [The Decoder](https://the-decoder.com/cursors-agent-swarm-suggests-cheaper-models-can-handle-most-coding-when-frontier-models-plan-the-work/). Humans should define checkable criteria before implementation. — [Survey post](https://redreamality.com/blog/coding-agent-done-claims-verification-survey/)
- **Detailed briefs:** Each subagent needs an objective, output format, tool guidance, and task boundaries. Vague delegation caused duplicated work and gaps. — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- **File ownership and isolation:** "Break the work so each teammate owns a different set of files." — [Agent teams docs](https://code.claude.com/docs/en/agent-teams). One container per agent. — [Anthropic](https://www.anthropic.com/engineering/building-c-compiler). Caveat: CooperBench shows spatial coordination does not fix semantic conflict. — [arXiv 2601.13295](https://arxiv.org/html/2601.13295)
- **Single writer:** Writes stay single-threaded and others add judgment. — [Cognition](https://cognition.com/blog/multi-agents-working)
- **Verification gates:** Hooks can block task completion: `TaskCompleted` or `TeammateIdle` exit 2 returns feedback. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams). Evidence receipts (command, exit code, commit hash), a re-run in a clean sandbox, mutation-style reverts to prove tests fail without the change, and a full-suite run on the combined code at merge. — [Survey post](https://redreamality.com/blog/coding-agent-done-claims-verification-survey/). Validate against CI before review, since failed CI is the clearest predictor of non-merge. — [arXiv 2601.15195](https://arxiv.org/html/2601.15195)
- **Clean-context reviewer:** The reviewer sees the diff without the author's reasoning. — [Cognition](https://cognition.com/blog/multi-agents-working). Vendor-authored, and Kilo sells such a reviewer. — [Kilo](https://blog.kilo.ai/p/how-7-kilo-code-engineers-run-up)
- **Hierarchy and fresh starts:** Planners, workers that do not coordinate with each other, a judge at each cycle, and fresh iterations. Remove complexity before adding it. — [Cursor](https://cursor.com/blog/scaling-agents)
- **Cheaper workers, frontier planner:** Reduced worker cost from $9,373 to $411 at comparable quality in one benchmark. A weak planner raises worker cost. — [The Decoder](https://the-decoder.com/cursors-agent-swarm-suggests-cheaper-models-can-handle-most-coding-when-frontier-models-plan-the-work/)
- **Durable state and references:** Store outputs in files and pass references. Checkpoint and resume. — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- **Attribution at merge:** Return each failure to the agent and change that caused it. — [Danjou](https://julien.danjou.info/blog/steve-yegge-deleted-the-wrong-thing) (vendor)
- **Small PRs, one task type per run:** — [arXiv 2601.15195](https://arxiv.org/html/2601.15195), [Kilo](https://blog.kilo.ai/p/how-7-kilo-code-engineers-run-up)
- **Structured status:** An independent recorder compares the closing summary against actual tool calls. — [Survey post](https://redreamality.com/blog/coding-agent-done-claims-verification-survey/). In Claude Code, idle notifications include the teammate's final answer, and failures on API errors are reported. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams)
- **Least privilege:** Permitted control-flow graphs and per-invocation rules. — [arXiv 2510.17276](https://arxiv.org/abs/2510.17276)
- **Reply contract wording (this repo, observed with real Codex):** An injected prompt must say the terminal is invisible to the requester, or agents print the answer and send a status note through the tool. — `docs/memory/conventions/20260801213547-an-injected-prompt-must-state-that-the-terminal-is-invisible.md`

### Inferences
- Priority order for an orchestrator: (1) independent verification, because self-report is unreliable; (2) decomposition checks; (3) limits on the human review queue; (4) richer messaging last, because CooperBench found messaging adds little.
- Make the reply schema carry evidence: commit hash, commands run, exit codes, files changed, and explicit "not verified" items. Let the server check these, not trust them.

### Gaps
- No comparative study shows which gate gives the most value per cost.

## What are the technical pitfalls of PTY input injection and output parsing, compared with SDK, hooks, or structured protocols?

### Takeaway
PTY injection works, but it has no delivery receipt, no stop reason, no provenance, and it breaks when the TUI changes. Real regressions confirm this. Vendors and tool builders use structured channels for state. Keep the PTY for human visibility and interactive-session features, and use hooks and MCP for everything that must be true.

### Cited Findings

PTY pitfalls (evidence is **[D]** bug reports and tool code, with real repros):
- **Paste and submit:** Claude Code bracketed paste treats a trailing newline as literal text, so a prompt lands without submit. The fix is to paste, then send Enter as a separate key. — [crow issue 264](https://github.com/radiusmethod/crow/issues/264). A 50 ms delay is used in the [crow patch](https://github.com/radiusmethod/crow/pull/274/files) (2nd-hand). A [cctop comment](https://docs.rs/crate/cctop/latest/source/src/inject.rs) reportedly describes the same race (2nd-hand; my fetch returned only the landing page).
- **Version regression:** Claude Code v2.1.119 on macOS ignored all submit keys in tmux. 18 variants failed, including bracketed paste, CSI-u, kitty protocol and `TERM` changes; a direct PTY worked. A bot closed it as a duplicate of #52724. — [anthropics/claude-code#52812](https://github.com/anthropics/claude-code/issues/52812). The reporter's use was daemonized automation.
- **Startup race:** Agent Teams `send-keys` fired before the shell was ready, so teammates did not start. — [issue 23513](https://claudeissues.com/issue/23513-team-agents-fail-to-start-tmux-send-keys-race-condition-with-shell-initializatio), [issue 40168](https://claudeissues.com/issue/40168-bug-agent-teams-tmux-split-pane-command-sent-via-send-keys-before-shell-is-ready) (2nd-hand, the mirror site did not load on direct fetch). The vendor's own product hit this class of bug.
- **No ack:** `send-keys` is fire-and-forget, with no exit code and no proof of landing. — [mager.co](https://mager.co/blog/2026-08-23-orchestrating-agents-with-tmux/) (2nd-hand)
- **Busy target:** Input to a busy agent may be read as user input. — [conduxt skill](https://clawhub.ai/skill/conduxt) (2nd-hand; the page is flagged as suspicious, so use only as a description of the problem)
- **Key encoding:** One library split literal text from control keys after embedded-escape parsing caused mismatches. — [@getpipher/term](https://cdn.jsdelivr.net/gh/getpipher/term@main/README.md) (2nd-hand)
- **Interactive gates:** In this repo, Codex workers stop at a directory trust prompt and an approval prompt on every `terminal_reply` call. Upstream: openai/codex#24135. — `docs/memory/facts/20260801213557-codex-dispatch-workers-are-not-hands-off-two-interactive-gat.md`
- **Transport ordering:** In this repo, a `Stop` hook can arrive before trailing PTY output, so relay activity is ignored for 6 seconds after a hook. A dropped `Stop` must self-heal or it stalls the dispatch inbox. — `docs/system/features/terminal-relay.md` lines 295-303
- **Hook transport quirk:** In this repo, CLI 2.1.251 silently drops `type: "http"` hooks on `SessionStart`, so that event uses a `command` hook. — `docs/system/features/terminal-relay.md` lines 274-277. Hooks are not stable either.

What structured channels give (vendor documentation, **[C]** for facts on features):
- **Claude Code hooks:** `Stop`, `SubagentStop`, `Notification` (`idle_prompt`, `permission_prompt`), `SessionStart`, `TaskCompleted`, `PreCompact`. `Stop` can block with exit 2 or `decision: "block"`. — [Hooks docs](https://code.claude.com/docs/en/hooks.md)
- **Agent SDK and `claude -p`:** `stream-json` events, `result` with cost and session ID, `--json-schema` structured output, `system/api_retry` events, `permission_denied` messages, `capabilities` for feature detection, SDK `interrupt()`, `canUseTool` callback, and `--resume` by session ID. — [Headless docs](https://code.claude.com/docs/en/headless.md)
- **Limits of SDK and `-p`:** `claude -p` and SDK sessions do not spawn teammates. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams). `--bare`, recommended for scripted calls, skips hooks, skills, CLAUDE.md and project MCP servers. It does not use subscription login. — [Headless docs](https://code.claude.com/docs/en/headless.md). Moving off the interactive TUI loses human takeover in the same terminal (my reading, not a sourced statement).
- **ACP:** JSON-RPC with `session/new`, `session/load`, `session/prompt`, a stop reason on the prompt response, `session/update` tool progress, `session/cancel`, and `session/request_permission`. — [ACP overview](https://agentclientprotocol.com/protocol/overview). A guide says it exists so that orchestrators can avoid scraping pseudo-TTYs. — [ACP guide](https://acp-guide.pages.dev/). It is designed for editor-to-agent use.
- **ACP adoption in practice:** One implementation covers only `initialize`, `session/new`, `session/prompt`, `session/list`. — [ZeptoClaw](https://docs.rs/crate/zeptoclaw/latest/source/docs/ACP_IMPLEMENTATION.md) (2nd-hand). Practitioners say JSON output or ACP is better when you need typed results, and tmux is better for keeping a process alive and a human view. — [mager.co](https://mager.co/blog/2026-08-23-orchestrating-agents-with-tmux/) (2nd-hand)
- **A2A:** Practitioners place it at cross-domain agent delegation, not low-level tool execution, with a "double-token tax" when two LLMs sit in the loop. — [MLOps Community](https://mlops.community/blog/ai-agents-as-an-operating-system-rediscovering-the-linux-philosophy) (2nd-hand, opinion)
- **Provenance:** Claude Code's `SendMessage` marks a message as from another session, not the user. — [Agent teams docs](https://code.claude.com/docs/en/agent-teams)

Current Engy state (from `docs/system/features/terminal-relay.md` lines 240-250 and 291-321):
- Delivery is a bracketed paste followed by Enter after a per-agent-type delay. This matches the fix above.
- Delivery is idle-gated with a per-worker inbox.
- Hook-driven activity replaces the bell and regex heuristic where hooks exist.
- A `Stop` that carries the delivered turn's `prompt_id` settles a dispatch as replied (`settledBy: 'hook'`) as a safety net.
- `StopFailure` holds the session out of delivery.

### Inferences
- A PTY paste is indistinguishable from user input to the worker. An `[engy-dispatch]` text marker is plain text, so it gives weaker provenance than a channel the CLI itself labels. A compromised or injected agent can reach a worker with user-level authority. This is my reasoning from the sources, not a tested attack on Engy.
- `settledBy: 'hook'` proves that the turn ended. It does not prove that work was done. Keep this state separate from a "done" verdict in UI and in lead logic, given OverclaimBench.
- The confirmed delivery signal for Claude workers should be `UserPromptSubmit` with the matching turn, not the paste write. A timeout with no such event should mean "not delivered". Engy has the hook; I did not check whether delivery uses it for retry.
- Pin or smoke-test CLI versions. An injection smoke test on CLI update would have caught #52812-class regressions early.
- Non-hook agents (Codex) stay on heuristics, and they have approval gates. Treat them as a lower-trust tier, or evaluate ACP or structured modes per agent.
- Migration path: keep PTY as the human view and input fallback. Move state to hooks now. Add ACP or SDK per agent type where it does not lose interactive takeover.

### Gaps
- No controlled reliability comparison of PTY injection against SDK or ACP (delivery failure rate, wrong-state rate). I found none.
- No solid production case study of ACP or A2A in coding orchestration. A2A evidence here is opinion only.
- Whether #52724 and #52812 were fixed, and how, is not visible in what I read.
- I read only the first part of the hooks reference. Exact `Stop` payload details are not confirmed here.
