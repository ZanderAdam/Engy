import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { replyToThread } from '../services/comment';
import { broadcastCommentChange } from '../ws/broadcast';
import { mcpResult, mcpError } from './result';

export function registerCommentTools(mcp: McpServer): void {
  mcp.tool(
    'replyToComment',
    'Reply to a diff or document comment thread. The thread id comes from the review feedback pasted into the terminal (`thread: <id>`). The reply is attributed to the agent, not the user.',
    {
      threadId: z.string().describe('Thread id from the feedback, e.g. `thread: <id>`'),
      body: z.string().min(1).describe('Reply text'),
      resolve: z
        .boolean()
        .optional()
        .describe('Mark the thread resolved after replying (default false)'),
    },
    async ({ threadId, body, resolve }) => {
      try {
        const result = replyToThread({ threadId, text: body, resolve });
        broadcastCommentChange(result.documentPath, result.threadId);
        return mcpResult(result);
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );
}
