export const LOCAL_USER_ID = 'local-user';
export const AGENT_USER_ID = 'agent';

export const REPLY_HINT =
  'Reply in a thread with the `replyToComment` MCP tool, passing its `thread:` id.';

export function threadIdLine(threadId: string): string {
  return `\`thread: ${threadId}\``;
}
