import { describe, it, expect } from 'vitest';
import { seedAgentSettings, normalizeAgentSettings } from './agent-settings';

describe('agent settings helpers', () => {
  describe('seedAgentSettings', () => {
    it('should seed legacy workspace skills into the claude entry', () => {
      const seeded = seedAgentSettings({
        agentSettings: null,
        planSkill: '/legacy:plan',
        implementSkill: '/legacy:implement',
      });
      expect(seeded.claude).toEqual({
        planSkill: '/legacy:plan',
        implementSkill: '/legacy:implement',
      });
    });

    it('should not overwrite per-agent skills with legacy values', () => {
      const seeded = seedAgentSettings({
        agentSettings: { claude: { planSkill: '/mine:plan' } },
        planSkill: '/legacy:plan',
        implementSkill: null,
      });
      expect(seeded.claude?.planSkill).toBe('/mine:plan');
      expect(seeded.claude?.implementSkill).toBeUndefined();
    });

    it('should keep other agents untouched', () => {
      const seeded = seedAgentSettings({
        agentSettings: { codex: { mode: 'read-only', active: false } },
        planSkill: null,
        implementSkill: null,
      });
      expect(seeded.codex).toEqual({ mode: 'read-only', active: false });
    });

    it('should not mutate the stored settings object', () => {
      const stored = { claude: { mode: 'plan' } };
      seedAgentSettings({ agentSettings: stored, planSkill: '/legacy:plan', implementSkill: null });
      expect(stored.claude).toEqual({ mode: 'plan' });
    });
  });

  describe('normalizeAgentSettings', () => {
    it('should trim skills and drop empty fields', () => {
      expect(
        normalizeAgentSettings({
          claude: { mode: 'plan', planSkill: '  /mine:plan  ', implementSkill: '   ' },
        }),
      ).toEqual({ claude: { mode: 'plan', planSkill: '/mine:plan' } });
    });

    it('should drop entries with nothing set', () => {
      expect(
        normalizeAgentSettings({ claude: {}, codex: { active: false } }),
      ).toEqual({ codex: { active: false } });
    });

    it('should keep explicit active flags', () => {
      expect(normalizeAgentSettings({ codex: { active: true } })).toEqual({
        codex: { active: true },
      });
    });
  });
});
