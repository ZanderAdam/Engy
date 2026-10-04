import type { AppState } from './trpc/context';
import { broadcastCommentLiveChange } from './ws/broadcast';

export function getLiveTarget(state: AppState, scopeKey: string): string | null {
  return state.liveCommentTargets.get(scopeKey)?.sessionId ?? null;
}

export function clearLiveTarget(state: AppState, scopeKey: string): void {
  if (!state.liveCommentTargets.delete(scopeKey)) return;
  broadcastCommentLiveChange(scopeKey, null);
}

export function clearLiveTargetsForSession(state: AppState, sessionId: string): void {
  for (const [scopeKey, target] of state.liveCommentTargets) {
    if (target.sessionId !== sessionId) continue;
    state.liveCommentTargets.delete(scopeKey);
    broadcastCommentLiveChange(scopeKey, null, 'session-ended');
  }
}
