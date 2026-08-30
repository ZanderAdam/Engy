import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAction } from '@/lib/voice/resolve';
import { assembleVoiceVocabulary, fetchAllTerminalSessions } from './use-voice-vocabulary';

describe('assembleVoiceVocabulary', () => {
  it('should return no actions without a workspace slug', () => {
    const actions = assembleVoiceVocabulary({
      workspaceSlug: '',
      projects: [{ slug: 'engy-web', name: 'engy-web' }],
      tabs: [],
      sessions: [],
      navigate: vi.fn(),
      activateTab: vi.fn(),
    });
    expect(actions).toEqual([]);
  });

  it('[FR-TG2.2] should build a select-project action from live project state', () => {
    const navigate = vi.fn();
    const actions = assembleVoiceVocabulary({
      workspaceSlug: 'engy',
      projects: [{ slug: 'engy-web', name: 'engy-web' }],
      tabs: [],
      sessions: [],
      navigate,
      activateTab: vi.fn(),
    });

    const resolved = resolveAction('select project engy web', actions);
    expect(resolved.matched).toBe(true);
    if (resolved.matched) void resolved.result.action.run({ params: resolved.result.params });
    expect(navigate).toHaveBeenCalledWith('/w/engy/projects/engy-web');
  });

  it('[FR-TG2.5] should include a terminal session from a project not in the open-projects list', () => {
    // A "mounted" project list that does not include the session's project —
    // proving the vocabulary never cross-filters terminals by which projects
    // happen to be open, the way the browser session store does.
    const actions = assembleVoiceVocabulary({
      workspaceSlug: 'engy',
      projects: [{ slug: 'mounted-project', name: 'Mounted Project' }],
      tabs: [],
      sessions: [{ sessionId: 'sess-unmounted', label: 'build' }],
      navigate: vi.fn(),
      activateTab: vi.fn(),
    });

    const focusAction = actions.find((a) => a.id === 'voice.terminal.focus');
    expect(focusAction).toBeDefined();

    const resolved = resolveAction('focus terminal build', actions);
    expect(resolved.matched).toBe(true);
    if (resolved.matched) {
      expect(resolved.result.action.id).toBe('voice.terminal.focus');
      expect(resolved.result.params.name).toBe('build');
    }
  });
});

describe('fetchAllTerminalSessions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[FR-TG2.5] should request the server session registry across every project via all=1', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessions: [{ sessionId: 'sess-1', scopeLabel: 'build', scopeType: 'project' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAllTerminalSessions();

    expect(fetchMock).toHaveBeenCalledWith('/api/terminal/sessions?all=1');
    expect(result).toEqual([{ sessionId: 'sess-1', label: 'build' }]);
  });

  it('should return no sessions when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ sessions: [] }) })),
    );
    expect(await fetchAllTerminalSessions()).toEqual([]);
  });
});
