# Selection Criteria — Worked Examples

Concrete keep-vs-skip judgments for the Session Distill filter. The governing test: **could a future reader recover this by reading the repo (code, comments, commits, diffs, CLAUDE.md, existing memories)?** If yes, skip it. If the knowledge lived only in the conversation, it is a candidate — then apply the non-obviousness and atomicity checks.

## Keep

### Decisions made in conversation
> During a fix, the team weighed a manual viewport save/restore against leaning on the library's native behavior, and chose native because the manual path raced under concurrent writes.

Keep **only if** the "because" is not already in the commit body. If the commit message already explains the rationale, the decision is recorded — skip it. The memory-worthy residue is rationale that exists *nowhere but the chat*.

### Gotchas found the hard way
> Driving an xterm terminal with a UI automation tool fails under continuous flood output because constant DOM mutation makes the tool's page snapshot time out.

Keep. This cost real trial-and-error, is not discoverable from any file, and will bite the next person who tries the same thing.

### Rejected approaches
> Tried killing a runaway shell loop with `pkill -f "<loop body>"`; it never matches because the loop body lives in the shell's memory, not its argv. Had to kill the PTY shell directly.

Keep. The *negative* result (why the obvious approach fails) is exactly what saves future time and never appears in committed code.

### Conventions discovered
> In this repo, a heavy component's behavior is verified manually rather than unit-tested, because the test setup silently skips the relevant file type.

Keep **only if** not already stated in CLAUDE.md or an existing memory. Cross-check before drafting (see Duplicates below).

## Skip

### Captured by the commit or code comment
> The scroll fix works by writing plainly and relying on the library's `isUserScrolling` flag.

Skip. This is in the code comment and the commit message. A memory restating it adds retrieval noise with zero new information.

### Narration and command logs
> First ran the gate, it failed on a sandbox permission error, re-ran outside the sandbox, then it passed.

Skip. Ephemeral process detail. Nothing here generalizes.

### Transient state
> The repo was mid-merge with everything staged; another session concluded the merge between two status checks.

Skip. True only at that instant; useless later.

### Restatement of existing knowledge
> Prefer the project's UI automation CLI over the browser MCP for functional checks.

Skip if a memory or CLAUDE.md already says this. Adding a near-duplicate splits retrieval rank across two entries and weakens both.

## Edge Cases

- **Two learnings tangled in one moment.** Split into separate candidates, each with its own central claim. Never join them with "and" in a single body — a multi-claim memory wins queries it should not and starves the rightful answer.
- **A learning that is half-recorded.** If the *what* is in code but the *why* is only in chat, the memory is just the why — keep it lean and point to the code in "Connects to".
- **Operational-for-Claude vs. domain knowledge.** Apply the boundary rule from SKILL.md: a tool quirk or testing technique is operational (flag for harness memory); a claim about the product's architecture, schema, or business rules belongs in the knowledge layer.
- **Tempting but speculative.** "We might want to refactor X someday" is not a learning; it is a TODO. Skip it — track it as a task, not a memory.

## Duplicates — Cross-Check Before Drafting

Before finalizing a "convention discovered" or "fact" candidate, scan for an existing equivalent (the knowledge layer via prior memories, and CLAUDE.md). If one exists and the session only *reinforced* it, skip. If the session *refined or contradicted* it, draft the candidate and name the conflict in the "Contradicts" line so `engy:review-memories` can supersede the old entry rather than create a redundant one.
