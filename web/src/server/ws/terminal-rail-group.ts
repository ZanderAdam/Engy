import type { AppState, TerminalRailGroup } from '../trpc/context';
import { broadcastTerminalRailGroupChange } from './broadcast';
import { persistTerminalSession } from './terminal-session-store';

const MAX_GROUP_NAME_LENGTH = 100;

interface RailGroupRequest {
  sessionIds: string[];
  group: TerminalRailGroup | null;
}

interface RailGroupResponse {
  status: number;
  body: { ok: true; updated: string[] } | { error: string };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseGroup(value: unknown): TerminalRailGroup | null | undefined {
  if (value === null) return null;
  if (value === undefined || typeof value !== 'object') return undefined;
  const { id, name } = value as Record<string, unknown>;
  if (!isNonEmptyString(id) || !isNonEmptyString(name)) return undefined;
  return { id, name: name.trim().slice(0, MAX_GROUP_NAME_LENGTH) };
}

function parseRequest(body: unknown): RailGroupRequest | string {
  if (body === null || typeof body !== 'object') return 'Body must be a JSON object';
  const { sessionIds, group } = body as Record<string, unknown>;
  if (
    !Array.isArray(sessionIds) ||
    sessionIds.length === 0 ||
    !sessionIds.every(isNonEmptyString)
  ) {
    return 'sessionIds must be a non-empty array of session id strings';
  }
  const parsedGroup = parseGroup(group);
  if (parsedGroup === undefined) {
    return 'group must be null (ungroup) or { id, name } with non-empty strings';
  }
  return { sessionIds, group: parsedGroup };
}

/**
 * `POST /api/terminal/sessions/group` — put sessions into a rail group, or take
 * them out with `group: null`. Renaming a group is the same call with every
 * member and the new name.
 */
export function handleTerminalRailGroupRequest(
  state: Pick<AppState, 'terminalSessionMeta'>,
  body: unknown,
): RailGroupResponse {
  const request = parseRequest(body);
  if (typeof request === 'string') return { status: 400, body: { error: request } };

  const updated: string[] = [];
  for (const sessionId of request.sessionIds) {
    const meta = state.terminalSessionMeta.get(sessionId);
    if (!meta) continue;
    meta.railGroup = request.group ?? undefined;
    persistTerminalSession(sessionId, meta);
    broadcastTerminalRailGroupChange(sessionId, meta.groupKey, request.group);
    updated.push(sessionId);
  }

  if (updated.length === 0) {
    return {
      status: 404,
      body: { error: 'None of the sessions exist; refresh the terminal list' },
    };
  }
  return { status: 200, body: { ok: true, updated } };
}
