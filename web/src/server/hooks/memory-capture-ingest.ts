import { eq } from 'drizzle-orm';
import type { FleetingMemoryType } from '@engy/common';
import { getDb } from '../db/client';
import { fleetingMemories, workspaces } from '../db/schema';
import { getHistoryWorkspaceSlug } from '../ws/terminal-session-history';
import type { AppState } from '../trpc/context';
import { MEMORY_CAPTURE_ORIGIN_TAG } from './memory';
import type { HookPayload } from './types';

// FR-MEMORY-250's caps, reused rather than imported: this is now the third
// independent fleeting-memory ingest channel (alongside CREATE_MEMORIES_EVENT
// and the direct createFleetingMemory tool call), each with its own insert
// shape, and the plan explicitly calls out that none may assume the others
// will be retired.
const MEMORY_CAPTURE_MAX_ITEMS = 50;
const MEMORY_CAPTURE_MAX_CONTENT_LENGTH = 10_000;

const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set(fleetingMemories.type.enumValues);

function clampMemoryType(type: unknown): FleetingMemoryType {
  return typeof type === 'string' && VALID_MEMORY_TYPES.has(type)
    ? (type as FleetingMemoryType)
    : 'capture';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === 'string' && t.length > 0);
}

function withOriginTag(tags: string[]): string[] {
  return tags.includes(MEMORY_CAPTURE_ORIGIN_TAG) ? tags : [...tags, MEMORY_CAPTURE_ORIGIN_TAG];
}

interface CaptureEntry {
  content: string;
  type: FleetingMemoryType;
  tags: string[];
}

/**
 * `raw` is the model's own stdout from the detached job — text derived from
 * an untrusted transcript, never trusted structurally. Malformed JSON, a
 * non-array `memories`, or an oversized/empty entry is dropped rather than
 * throwing; the surviving set is capped like every other ingest channel
 * (FR-MEMORY-250), filtering before capping so invalid entries never crowd
 * out valid ones.
 */
function parseDistillation(raw: unknown): CaptureEntry[] {
  if (typeof raw !== 'string' || !raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const memories = isRecord(parsed) ? parsed.memories : undefined;
  if (!Array.isArray(memories)) return [];

  const valid = memories.filter(isRecord).filter(
    (m): m is Record<string, unknown> & { content: string } =>
      typeof m.content === 'string' &&
      m.content.length > 0 &&
      m.content.length <= MEMORY_CAPTURE_MAX_CONTENT_LENGTH,
  );

  return valid.slice(0, MEMORY_CAPTURE_MAX_ITEMS).map((m) => ({
    content: m.content,
    type: clampMemoryType(m.type),
    tags: withOriginTag(sanitizeTags(m.tags)),
  }));
}

/**
 * Ingests the shell script's follow-up POST (`hooks/memory.ts`). Not a
 * `HookHandler` — it is dispatched from `handleHookRequest` before that
 * function's meta-liveness gate, because by the time this arrives (up to
 * ~20s after PreCompact or SessionEnd) the originating terminal may already
 * be gone: SessionEnd's parent PTY exits almost immediately once the hook
 * returns, which deletes `terminalSessionMeta` for that session id long
 * before this background job finishes. Live meta is tried first (the common
 * case — PreCompact fires mid-session); `getHistoryWorkspaceSlug` covers
 * SessionEnd for first-run sessions once meta is gone. A resumed session
 * whose meta is already gone has no resolvable workspace (its history row is
 * keyed by the prior agent-CLI conversation id, not this terminal session
 * id) and is dropped, matching FR-MEMORY-250's "unknown session → insert
 * nothing" precedent.
 */
export function handleMemoryCaptureIngest(
  state: Pick<AppState, 'terminalSessionMeta'>,
  payload: HookPayload,
  sessionId: string,
): void {
  const workspaceSlug =
    state.terminalSessionMeta.get(sessionId)?.workspaceSlug ?? getHistoryWorkspaceSlug(sessionId);
  if (!workspaceSlug) {
    console.warn(`[hooks] MemoryCapture: cannot resolve workspace for session=${sessionId}`);
    return;
  }

  const db = getDb();
  const workspace = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!workspace) return;

  const entries = parseDistillation(payload.distillation);
  if (entries.length === 0) return;

  const now = new Date().toISOString();
  db.insert(fleetingMemories)
    .values(
      entries.map((e) => ({
        workspaceId: workspace.id,
        content: e.content,
        type: e.type,
        source: 'agent' as const,
        tags: e.tags,
        createdAt: now,
      })),
    )
    .run();
}
