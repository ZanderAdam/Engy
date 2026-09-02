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

Read the thread's current text first with \`diff_review_list\` (repoDir, filePath), in case it changed since this prompt was written.

Report back into the thread itself with \`replyToComment\` (threadId ${threadId}), so the verdict sits on the line it is about. One of:
- VERIFIED (rung 4 or 5) — name the artifact: a test file:line, or the repro command and its output.
- NOT VERIFIED — include the output that disproves it, and pass \`resolve: true\` so the finding stops standing.
- INCONCLUSIVE — say what blocked verification and what would settle it. Leave the thread open.`;
}
