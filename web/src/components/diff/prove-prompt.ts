interface ProvePromptInput {
  threadId: string;
  repoDir: string;
  filePath: string;
  lineNumber: number;
  findingBody: string;
}

/**
 * Self-contained on purpose: this lands in whatever terminal agent is open,
 * which has not loaded Engy's evidence ladder and would read a bare "rung 4"
 * as noise.
 */
export function buildProvePrompt({
  threadId,
  repoDir,
  filePath,
  lineNumber,
  findingBody,
}: ProvePromptInput): string {
  return `Prove or disprove this review finding at ${filePath}:${lineNumber}.

${findingBody}

Run the code. Produce a failing test, or a command whose output shows the failure. Reading the code and reasoning that it must break does not count here, however convincing — the whole point of this request is to replace an argument with an artifact. Take only this one finding that far; do not review anything else.

Read the finding's current text first with the \`diff_review_list\` MCP tool (repoDir ${repoDir}, filePath ${filePath}), in case it changed since this prompt was written.

Report back with the \`replyToComment\` MCP tool (threadId ${threadId}), so the answer lands on the line it is about rather than scrolling away here. Reply with exactly one of:
- VERIFIED — name the artifact: the test file:line you added, or the command and its output.
- NOT VERIFIED — include the output that disproves it, and pass \`resolve: true\` to retract the finding.
- INCONCLUSIVE — say what blocked you and what would settle it. Leave the thread open.`;
}
