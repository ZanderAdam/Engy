import { z } from 'zod';
import { and, asc, eq, isNull, like, type SQL } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db/client';
import { commentThreads, threadComments } from '../db/schema';
import { getAppState } from '../trpc/context';
import { broadcastCommentChange } from '../ws/broadcast';
import { randomId } from '@/lib/random-id';
import { mcpError, mcpResult } from './result';

// Diff-review authoring tools. Agent-only (no tRPC counterparts by design —
// the browser writes the same rows through comment.createThread and builds the
// `diff://` path itself in use-diff-comments.ts; these tools exist so an agent
// does not have to reconstruct that path and metadata shape by hand).
//
// Every row written here is workspace-less. The Diffs tab reads through
// comment.listThreadsByPrefix with no workspaceSlug, which filters on
// `workspaceId IS NULL` — a workspace-scoped thread would be invisible to it.

const AGENT_USER_ID = 'agent';

const severityField = z
  .enum(['critical', 'high', 'medium'])
  .describe(
    'critical: breaks correctness, security, data loss. high: architectural violation, missing error handling for a likely failure. medium: pattern, naming, readability',
  );

const diffReviewCommentInput = {
  repoDir: z.string().min(1).describe('Absolute path of the repo or worktree under review'),
  filePath: z.string().min(1).describe('Path of the file, relative to the repo root'),
  lineNumber: z.number().int().positive().describe("Line number in its own side's numbering"),
  codeLine: z.string().describe('Text of the line, so the finding survives being read out of context'),
  side: z
    .enum(['modified', 'original'])
    .default('modified')
    .describe("'original' only for a deleted line, which has no new-side number to anchor to"),
  severity: severityField,
  finding: z.string().min(1).describe('The claim, in one sentence'),
  failureScenario: z
    .string()
    .min(1)
    .describe(
      'Concrete inputs or state that produce the wrong result. If you cannot describe how the code breaks, it is not a finding — leave it out',
    ),
  suggestedFix: z.string().optional().describe('Concrete change that resolves it'),
  evidence: z
    .string()
    .optional()
    .describe(
      'How far up the evidence ladder this got and what proves it, e.g. "rung 4: auth.test.ts:12 reproduces it". Findings that only assert are worth less to the reader than ones that ran',
    ),
};

const diffReviewResolveInput = {
  threadId: z.string().min(1).describe('Thread id from diff_review_list'),
};

const diffReviewSummaryInput = {
  repoDir: z.string().min(1).describe('Absolute path of the repo or worktree under review'),
  summary: z
    .string()
    .min(1)
    .describe(
      'Markdown read before any file: a three-sentence overview, the order to read the changed files in and what to check in each, architectural decisions and why, breaking-change risk, then anything not worth anchoring inline',
    ),
};

const diffReviewListInput = {
  repoDir: z.string().min(1).describe('Absolute path of the repo or worktree under review'),
  filePath: z.string().optional().describe('Restrict to one file, relative to the repo root'),
};

function summaryPath(repoDir: string): string {
  return `diff://${repoDir}/`;
}

function filePath(repoDir: string, file: string): string {
  return `diff://${repoDir}/${file}`;
}

/** Author fields the caller cannot set, so `source: 'agent'` stays trustworthy. */
function authorMetadata(callerTerminalSessionId?: string) {
  const meta = callerTerminalSessionId
    ? getAppState().terminalSessionMeta.get(callerTerminalSessionId)
    : undefined;
  return {
    source: 'agent' as const,
    ...(callerTerminalSessionId ? { agentSessionId: callerTerminalSessionId } : {}),
    ...(meta?.agentType ? { agentType: meta.agentType } : {}),
  };
}

function insertThread(documentPath: string, metadata: Record<string, unknown>, body: string): string {
  const db = getDb();
  const threadId = randomId();
  const now = new Date().toISOString();

  db.insert(commentThreads)
    .values({ id: threadId, workspaceId: null, documentPath, metadata, createdAt: now, updatedAt: now })
    .run();
  db.insert(threadComments)
    .values({
      id: randomId(),
      threadId,
      userId: AGENT_USER_ID,
      body,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return threadId;
}

function readThreadsWhere(condition: SQL | undefined) {
  const db = getDb();
  return db
    .select()
    .from(commentThreads)
    .where(and(isNull(commentThreads.workspaceId), condition))
    .orderBy(asc(commentThreads.createdAt))
    .all();
}

function firstCommentBody(threadId: string): string {
  const comment = getDb()
    .select()
    .from(threadComments)
    .where(and(eq(threadComments.threadId, threadId), isNull(threadComments.deletedAt)))
    .orderBy(asc(threadComments.createdAt))
    .get();
  return typeof comment?.body === 'string' ? comment.body : JSON.stringify(comment?.body ?? null);
}

function findingBody(input: {
  finding: string;
  failureScenario: string;
  suggestedFix?: string;
}): string {
  const parts = [input.finding, `Fails when: ${input.failureScenario}`];
  if (input.suggestedFix) parts.push(`Fix: ${input.suggestedFix}`);
  return parts.join('\n\n');
}

export function registerDiffReviewTools(mcp: McpServer, callerTerminalSessionId?: string): void {
  mcp.tool(
    'diff_review_comment',
    'Anchor one review finding to a line of the diff under review, where it appears inline in the Diffs tab. Anchor only what a reader must act on; everything else belongs in diff_review_summary.',
    diffReviewCommentInput,
    async (args) => {
      const threadId = insertThread(
        filePath(args.repoDir, args.filePath),
        {
          type: 'diff',
          ...authorMetadata(callerTerminalSessionId),
          lineNumber: args.lineNumber,
          codeLine: args.codeLine,
          side: args.side,
          severity: args.severity,
          ...(args.evidence ? { evidence: args.evidence } : {}),
        },
        findingBody(args),
      );
      broadcastCommentChange(filePath(args.repoDir, args.filePath));
      return mcpResult({ threadId });
    },
  );

  mcp.tool(
    'diff_review_summary',
    'Write the review summary shown above the first file of the diff. Replaces the previous summary for this repo; anchored findings are left alone.',
    diffReviewSummaryInput,
    async (args) => {
      const db = getDb();
      const path = summaryPath(args.repoDir);
      db.delete(commentThreads)
        .where(and(eq(commentThreads.documentPath, path), isNull(commentThreads.workspaceId)))
        .run();

      const threadId = insertThread(
        path,
        { type: 'review-summary', ...authorMetadata(callerTerminalSessionId) },
        args.summary,
      );
      broadcastCommentChange(path);
      return mcpResult({ threadId });
    },
  );

  mcp.tool(
    'diff_review_resolve',
    "Mark one of your own findings resolved — you re-reviewed and it no longer stands. Refuses threads you did not write: closing a human's comment is their call, not yours.",
    diffReviewResolveInput,
    async (args) => {
      const db = getDb();
      const thread = db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, args.threadId))
        .get();

      if (!thread) return mcpError(`No thread with id "${args.threadId}"`);

      const meta = (thread.metadata ?? {}) as Record<string, unknown>;
      if (meta.source !== 'agent') {
        return mcpError(
          `Thread "${args.threadId}" was not written by an agent. Reply to it instead — only the person who wrote it can resolve it.`,
        );
      }

      const now = new Date().toISOString();
      db.update(commentThreads)
        .set({ resolved: true, resolvedBy: AGENT_USER_ID, resolvedAt: now, updatedAt: now })
        .where(eq(commentThreads.id, args.threadId))
        .run();
      broadcastCommentChange(thread.documentPath);
      return mcpResult({ threadId: args.threadId, resolved: true });
    },
  );

  mcp.tool(
    'diff_review_list',
    'Read the review already on this diff — your own findings and the human comments left on it. Call before filing, so a re-review answers open comments instead of repeating findings that already stand.',
    diffReviewListInput,
    async (args) => {
      const repoPrefix = summaryPath(args.repoDir);

      // A prefix match would pair every `Foo.ts` with `Foo.tsx`, so one file is
      // read by exact path and only the repo-wide case scans by prefix.
      const rows = args.filePath
        ? readThreadsWhere(eq(commentThreads.documentPath, filePath(args.repoDir, args.filePath)))
        : readThreadsWhere(like(commentThreads.documentPath, `${repoPrefix}%`));

      const threads = rows.map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        return {
          threadId: row.id,
          type: meta.type ?? 'diff',
          source: meta.source ?? 'local',
          filePath: row.documentPath.slice(repoPrefix.length) || null,
          lineNumber: meta.lineNumber ?? null,
          side: meta.side ?? null,
          severity: meta.severity ?? null,
          evidence: meta.evidence ?? null,
          resolved: row.resolved ?? false,
          body: firstCommentBody(row.id),
        };
      });

      const summary = threads.find((t) => t.type === 'review-summary');
      return mcpResult({
        threads,
        summary: summary ? summary.body : null,
      });
    },
  );
}
