import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../trpc/root';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { fleetingMemories } from '../db/schema';
import { recordSessionStart } from '../ws/terminal-session-history';
import type { TerminalSessionMeta } from '../trpc/context';
import type { HookPayload } from './types';
import { MEMORY_CAPTURE_HOOK_EVENT, MEMORY_CAPTURE_ORIGIN_TAG } from './memory';
import { handleMemoryCaptureIngest } from './memory-capture-ingest';

function baseMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'Test Session',
    workingDir: '/tmp/engy-test',
    agentType: 'claude',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function distillationPayload(memories: unknown): HookPayload {
  return {
    hook_event_name: MEMORY_CAPTURE_HOOK_EVENT,
    distillation: JSON.stringify({ memories }),
  };
}

describe('handleMemoryCaptureIngest', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('[FR-MEMORY-300] should insert a fleeting memory for each valid entry when the terminal session is still live', async () => {
    const ws = await caller.workspace.create({ name: 'Capture WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      distillationPayload([{ content: 'Core claim: a', type: 'capture', tags: ['x'] }]),
      'sess-1',
    );

    const rows = ctx.db.select().from(fleetingMemories).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Core claim: a');
    expect(rows[0].source).toBe('agent');
  });

  it('[FR-MEMORY-310] should force-set the origin tag even when the model omits tags entirely', async () => {
    const ws = await caller.workspace.create({ name: 'Origin Tag WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      distillationPayload([{ content: 'Core claim: a' }]),
      'sess-1',
    );

    const rows = ctx.db.select().from(fleetingMemories).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tags).toEqual([MEMORY_CAPTURE_ORIGIN_TAG]);
  });

  it('[FR-MEMORY-310] should not duplicate the origin tag when the model already included it', async () => {
    const ws = await caller.workspace.create({ name: 'Origin Tag Dup WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      distillationPayload([{ content: 'Core claim: a', tags: ['x', MEMORY_CAPTURE_ORIGIN_TAG] }]),
      'sess-1',
    );

    const rows = ctx.db.select().from(fleetingMemories).all();
    expect(rows[0].tags).toEqual(['x', MEMORY_CAPTURE_ORIGIN_TAG]);
  });

  it('[FR-MEMORY-300] should fall back to session history once live meta is gone (SessionEnd)', async () => {
    const ws = await caller.workspace.create({ name: 'History Fallback WS' });
    // Simulates the terminal's PTY having already exited: recordSessionStart
    // ran at spawn time, but nothing lives in terminalSessionMeta anymore.
    recordSessionStart('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      distillationPayload([{ content: 'Core claim: from history' }]),
      'sess-1',
    );

    const rows = ctx.db.select().from(fleetingMemories).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Core claim: from history');
  });

  it('should insert nothing when the session is unknown to both live meta and history', () => {
    handleMemoryCaptureIngest(
      ctx.state,
      distillationPayload([{ content: 'Core claim: orphaned' }]),
      'sess-unknown',
    );

    expect(ctx.db.select().from(fleetingMemories).all()).toHaveLength(0);
  });

  it('[FR-MEMORY-250] should drop empty or oversized entries and cap the rest at 50', async () => {
    const ws = await caller.workspace.create({ name: 'Caps WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    const memories = [
      { content: '' }, // dropped: empty
      { content: 'x'.repeat(10_001) }, // dropped: over the char cap
      ...Array.from({ length: 55 }, (_, i) => ({ content: `Core claim: ${i}` })),
    ];

    handleMemoryCaptureIngest(ctx.state, distillationPayload(memories), 'sess-1');

    const rows = ctx.db.select().from(fleetingMemories).all();
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.content.startsWith('Core claim:'))).toBe(true);
  });

  it('[FR-MEMORY-250] should clamp an unrecognized type to capture', async () => {
    const ws = await caller.workspace.create({ name: 'Type Clamp WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      distillationPayload([{ content: 'Core claim: a', type: 'not-a-real-type' }]),
      'sess-1',
    );

    const rows = ctx.db.select().from(fleetingMemories).all();
    expect(rows[0].type).toBe('capture');
  });

  it('should insert nothing for malformed JSON distillation', async () => {
    const ws = await caller.workspace.create({ name: 'Malformed WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      { hook_event_name: MEMORY_CAPTURE_HOOK_EVENT, distillation: '{not valid json' },
      'sess-1',
    );

    expect(ctx.db.select().from(fleetingMemories).all()).toHaveLength(0);
  });

  it('should insert nothing when memories is missing or not an array', async () => {
    const ws = await caller.workspace.create({ name: 'Shape WS' });
    ctx.state.terminalSessionMeta.set('sess-1', baseMeta({ workspaceSlug: ws.slug }));

    handleMemoryCaptureIngest(
      ctx.state,
      { hook_event_name: MEMORY_CAPTURE_HOOK_EVENT, distillation: JSON.stringify({}) },
      'sess-1',
    );
    handleMemoryCaptureIngest(
      ctx.state,
      {
        hook_event_name: MEMORY_CAPTURE_HOOK_EVENT,
        distillation: JSON.stringify({ memories: 'nope' }),
      },
      'sess-1',
    );

    expect(ctx.db.select().from(fleetingMemories).all()).toHaveLength(0);
  });

  it('should insert nothing when distillation is absent or not a string', () => {
    handleMemoryCaptureIngest(ctx.state, { hook_event_name: MEMORY_CAPTURE_HOOK_EVENT }, 'sess-1');
    handleMemoryCaptureIngest(
      ctx.state,
      { hook_event_name: MEMORY_CAPTURE_HOOK_EVENT, distillation: { not: 'a string' } },
      'sess-1',
    );

    expect(ctx.db.select().from(fleetingMemories).all()).toHaveLength(0);
  });
});
