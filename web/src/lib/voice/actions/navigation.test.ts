import { describe, it, expect, vi } from 'vitest';
import { resolveAction } from '../resolve';
import { createNavigationActions, matchByName } from './navigation';

describe('navigation actions', () => {
  describe('matchByName', () => {
    it('should return the exact match when present', () => {
      const items = [{ name: 'engy-web' }, { name: 'client' }];
      expect(matchByName(items, 'engy-web', (i) => i.name)).toBe(items[0]);
    });

    it('should tolerate an STT-mangled slug', () => {
      const items = [{ name: 'engy-web' }, { name: 'client' }];
      expect(matchByName(items, 'engie web', (i) => i.name)).toBe(items[0]);
    });

    it('should reject rather than guess below threshold', () => {
      const items = [{ name: 'engy-web' }, { name: 'client' }];
      expect(matchByName(items, 'completely unrelated words', (i) => i.name)).toBeUndefined();
    });

    it('should return undefined for an empty item list', () => {
      expect(matchByName([], 'anything', (i: { name: string }) => i.name)).toBeUndefined();
    });
  });

  describe('createNavigationActions', () => {
    it('[FR-TG2.4] should navigate to the matched project via the injected navigate function', () => {
      const navigate = vi.fn();
      const actions = createNavigationActions({
        workspaceSlug: 'engy',
        projects: [{ slug: 'engy-web', name: 'engy-web' }],
        tabs: [],
        navigate,
        activateTab: vi.fn(),
      });

      const resolved = resolveAction('select project engy web', actions);
      expect(resolved.matched).toBe(true);
      if (resolved.matched) void resolved.result.action.run({ params: resolved.result.params });

      expect(navigate).toHaveBeenCalledWith('/w/engy/projects/engy-web');
    });

    it('should never bypass the injected navigate function for project selection', () => {
      const navigate = vi.fn();
      const actions = createNavigationActions({
        workspaceSlug: 'engy',
        projects: [{ slug: 'engy-web', name: 'engy-web' }],
        tabs: [],
        navigate,
        activateTab: vi.fn(),
      });
      const action = actions.find((a) => a.id === 'voice.navigation.select-project')!;
      void action.run({ params: { name: 'completely unrelated words' } });
      expect(navigate).not.toHaveBeenCalled();
    });

    it('should omit the select-project action when no projects are open', () => {
      const actions = createNavigationActions({
        workspaceSlug: 'engy',
        projects: [],
        tabs: [{ id: 'tab-1', label: 'engy-web' }],
        navigate: vi.fn(),
        activateTab: vi.fn(),
      });
      expect(actions.find((a) => a.id === 'voice.navigation.select-project')).toBeUndefined();
    });

    it('[FR-TG2.4] should activate the matched tab via activateTab, not navigate', () => {
      const navigate = vi.fn();
      const activateTab = vi.fn();
      const actions = createNavigationActions({
        workspaceSlug: 'engy',
        projects: [],
        tabs: [{ id: 'tab-1', label: 'engy-web docs' }],
        navigate,
        activateTab,
      });

      const resolved = resolveAction('open tab engy web docs', actions);
      expect(resolved.matched).toBe(true);
      if (resolved.matched) void resolved.result.action.run({ params: resolved.result.params });

      expect(activateTab).toHaveBeenCalledWith('tab-1');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('should omit the open-tab action when no tabs are open', () => {
      const actions = createNavigationActions({
        workspaceSlug: 'engy',
        projects: [{ slug: 'engy-web', name: 'engy-web' }],
        tabs: [],
        navigate: vi.fn(),
        activateTab: vi.fn(),
      });
      expect(actions.find((a) => a.id === 'voice.navigation.open-tab')).toBeUndefined();
    });
  });
});
