import { TRPCError } from '@trpc/server';
import type { AppState, LiveCommentTarget } from './trpc/context';
import { canInjectNow, injectPromptToTerminal } from './terminal-dispatch';
import { broadcastCommentLiveChange } from './ws/broadcast';
import { scopeContains, type CommentScope } from './services/comment';
import {
  buildPendingFeedback,
  markCommentsSent,
  type PendingFeedbackOptions,
} from './services/comment-feedback';

function requireSession(state: AppState, sessionId: string): void {
  if (state.terminalSessionMeta.has(sessionId)) return;
  throw new TRPCError({
    code: 'NOT_FOUND',
    message: `Terminal session "${sessionId}" is not running. Focus a running terminal and try again.`,
  });
}

export function sendPendingComments(
  state: AppState,
  sessionId: string,
  scope: CommentScope,
  opts: PendingFeedbackOptions = {},
): number {
  requireSession(state, sessionId);
  const feedback = buildPendingFeedback(scope, opts);
  if (feedback.commentIds.length === 0) return 0;

  if (!injectPromptToTerminal(state, sessionId, feedback.text)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'No daemon connected, so the comments could not reach the terminal. Start the Engy daemon and send again.',
    });
  }
  markCommentsSent(feedback.commentIds);
  return feedback.commentIds.length;
}

/** A busy agent gets nothing now; its next idle transition calls flushLiveComments. Returns true when it pasted. */
function deliverLive(state: AppState, target: LiveCommentTarget): boolean {
  if (!canInjectNow(state, target.sessionId)) return false;
  try {
    const sent = sendPendingComments(state, target.sessionId, target.scope, {
      filePath: target.filePath,
      requireUserComment: true,
    });
    return sent > 0;
  } catch (err) {
    console.warn(`[comments] live send to ${target.sessionId.slice(0, 8)} failed:`, err);
    return false;
  }
}

export function setLiveTarget(state: AppState, scopeKey: string, target: LiveCommentTarget): void {
  requireSession(state, target.sessionId);
  state.liveCommentTargets.set(scopeKey, target);
  broadcastCommentLiveChange(scopeKey, target.sessionId);
  deliverLive(state, target);
}

export function onUserComment(
  state: AppState,
  workspaceId: number | null,
  documentPath: string,
): void {
  for (const target of state.liveCommentTargets.values()) {
    if (scopeContains(target.scope, workspaceId, documentPath)) deliverLive(state, target);
  }
}

// One paste per idle transition: a second paste before the first one's delayed
// Enter would merge both into one prompt.
export function flushLiveComments(state: AppState, sessionId: string): void {
  for (const target of state.liveCommentTargets.values()) {
    if (target.sessionId === sessionId && deliverLive(state, target)) return;
  }
}
