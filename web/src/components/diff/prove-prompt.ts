interface ProvePromptInput {
  threadId: string;
  filePath: string;
  lineNumber: number;
  findingBody: string;
}

export function buildProvePrompt({
  threadId,
  filePath,
  lineNumber,
  findingBody,
}: ProvePromptInput): string {
  return `Prove finding ${threadId} at ${filePath}:${lineNumber}.

${findingBody}

Climb this one finding to rung 4 of the evidence ladder: run code on the real path in this worktree and produce a failing test or a concrete repro command. Asserting it, citing a file:line, or reasoning about the failure path (rungs 1-3) is not enough here.

Call the Engy MCP tool \`diff_review_list\` (repoDir, filePath) first, to read the thread's current text in case it changed since this prompt was written.

No MCP tool posts a reply into an existing thread, so report here in the terminal with one verdict:
- VERIFIED (rung 4 or 5) — name the artifact: a test file:line, or the repro command and its output.
- NOT VERIFIED — include the output that disproves it, then call \`diff_review_resolve\` on this thread id so the finding stops standing.
- INCONCLUSIVE — say what blocked verification and what would settle it. Leave the thread open.`;
}
