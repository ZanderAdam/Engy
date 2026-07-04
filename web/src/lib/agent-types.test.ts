import { describe, it, expect, vi } from 'vitest';
import {
  buildAgentCommand,
  coerceAgentTypeId,
  getAgentType,
  getMcpUrl,
  isAgentTypeId,
  isAgentActive,
  isAgentModeId,
  listAgentTypes,
  resolveAgentMode,
  resolveAgentSkills,
  MCP_SESSION_PLACEHOLDER,
} from './agent-types';

describe('agent types', () => {
  describe('registry', () => {
    it('should list claude and codex', () => {
      expect(listAgentTypes().map((a) => a.id)).toEqual(['claude', 'codex']);
    });

    it('should default to claude for undefined ids', () => {
      expect(getAgentType(undefined).id).toBe('claude');
    });

    it('should recognize valid agent type ids', () => {
      expect(isAgentTypeId('claude')).toBe(true);
      expect(isAgentTypeId('codex')).toBe(true);
      expect(isAgentTypeId('gemini')).toBe(false);
    });

    it('should coerce values to a valid id, defaulting unknown/null to claude', () => {
      expect(coerceAgentTypeId('codex')).toBe('codex');
      expect(coerceAgentTypeId('claude')).toBe('claude');
      expect(coerceAgentTypeId('gemini')).toBe('claude');
      expect(coerceAgentTypeId(null)).toBe('claude');
      expect(coerceAgentTypeId(undefined)).toBe('claude');
    });
  });

  describe('claude command', () => {
    it('should return base command with permission mode when no options', () => {
      expect(buildAgentCommand('claude')).toBe('claude --permission-mode acceptEdits');
    });

    it('should include prompt when provided', () => {
      expect(buildAgentCommand('claude', { prompt: 'Use /engy:plan to plan engy-T1' })).toBe(
        "claude 'Use /engy:plan to plan engy-T1' --permission-mode acceptEdits",
      );
    });

    it('should include add-dir flags when provided', () => {
      expect(buildAgentCommand('claude', { additionalDirs: ['/some/dir'] })).toBe(
        "claude --add-dir '/some/dir' --permission-mode acceptEdits",
      );
    });

    it('should escape single quotes in prompt', () => {
      expect(buildAgentCommand('claude', { prompt: "it's a test" })).toBe(
        "claude 'it'\\''s a test' --permission-mode acceptEdits",
      );
    });

    it('should include --append-system-prompt when systemPrompt provided', () => {
      expect(buildAgentCommand('claude', { systemPrompt: 'Workspace: engy (id: 1)' })).toBe(
        "claude --append-system-prompt 'Workspace: engy (id: 1)' --permission-mode acceptEdits",
      );
    });

    it('should include prompt, add-dir, and system prompt together', () => {
      expect(
        buildAgentCommand('claude', {
          prompt: 'Use /engy:plan',
          systemPrompt: 'Workspace: engy (id: 1)',
          additionalDirs: ['/repo'],
        }),
      ).toBe(
        "claude 'Use /engy:plan' --add-dir '/repo' --append-system-prompt 'Workspace: engy (id: 1)' --permission-mode acceptEdits",
      );
    });

    it('should use --dangerously-skip-permissions instead of --permission-mode when flag set', () => {
      expect(buildAgentCommand('claude', { dangerouslySkipPermissions: true })).toBe(
        'claude --dangerously-skip-permissions',
      );
    });

    it('should register the Engy MCP server via --mcp-config when mcpUrl provided', () => {
      const cmd = buildAgentCommand('claude', { mcpUrl: 'http://localhost:3123/mcp' });
      expect(cmd).toContain('--mcp-config');
      expect(cmd).toContain('"Engy"');
      expect(cmd).toContain('"http://localhost:3123/mcp"');
      expect(cmd).toContain('"type":"http"');
    });
  });

  describe('codex command', () => {
    it('should default to workspace-write sandbox when no options', () => {
      expect(buildAgentCommand('codex')).toBe('codex --sandbox workspace-write');
    });

    it('should include prompt when provided', () => {
      expect(buildAgentCommand('codex', { prompt: 'fix the tests' })).toBe(
        "codex 'fix the tests' --sandbox workspace-write",
      );
    });

    it('should fold system prompt into the prompt when both provided', () => {
      expect(
        buildAgentCommand('codex', { prompt: 'fix the tests', systemPrompt: 'Workspace: engy' }),
      ).toBe("codex 'Workspace: engy\n\nfix the tests' --sandbox workspace-write");
    });

    it('should skip the context block when no prompt (no burned turn)', () => {
      expect(buildAgentCommand('codex', { systemPrompt: 'Workspace: engy' })).toBe(
        'codex --sandbox workspace-write',
      );
    });

    it('should include add-dir flags when provided', () => {
      expect(buildAgentCommand('codex', { additionalDirs: ['/some/dir'] })).toBe(
        "codex --add-dir '/some/dir' --sandbox workspace-write",
      );
    });

    it('should register the Engy MCP server via -c config override when mcpUrl provided', () => {
      expect(buildAgentCommand('codex', { mcpUrl: 'http://localhost:3123/mcp' })).toBe(
        `codex -c 'mcp_servers.Engy.url="http://localhost:3123/mcp"' --sandbox workspace-write`,
      );
    });

    it('should use --dangerously-bypass-approvals-and-sandbox instead of the sandbox flag when skip set', () => {
      expect(buildAgentCommand('codex', { dangerouslySkipPermissions: true })).toBe(
        'codex --dangerously-bypass-approvals-and-sandbox',
      );
    });
  });

  describe('per-agent workspace settings', () => {
    describe('mode in built commands', () => {
      it('[FR-WORKSPACE-150] should apply the configured claude permission mode', () => {
        expect(buildAgentCommand('claude', { agentSettings: { claude: { mode: 'plan' } } })).toBe(
          'claude --permission-mode plan',
        );
      });

      it('[FR-WORKSPACE-150] should fall back to acceptEdits for an unknown claude mode', () => {
        expect(
          buildAgentCommand('claude', { agentSettings: { claude: { mode: 'yolo' } } }),
        ).toBe('claude --permission-mode acceptEdits');
      });

      it("[FR-WORKSPACE-150] should ignore the OTHER agent's configured mode", () => {
        expect(buildAgentCommand('claude', { agentSettings: { codex: { mode: 'read-only' } } })).toBe(
          'claude --permission-mode acceptEdits',
        );
      });

      it('[FR-WORKSPACE-150] should let permission-bypass (container) override the configured mode', () => {
        expect(
          buildAgentCommand('claude', {
            dangerouslySkipPermissions: true,
            agentSettings: { claude: { mode: 'plan' } },
          }),
        ).toBe('claude --dangerously-skip-permissions');
      });

      it('[FR-WORKSPACE-150] should map the codex full-auto preset to sandbox + approval flags', () => {
        expect(buildAgentCommand('codex', { agentSettings: { codex: { mode: 'full-auto' } } })).toBe(
          'codex --sandbox workspace-write --ask-for-approval never',
        );
      });

      it('[FR-WORKSPACE-150] should map the codex danger-full-access preset', () => {
        expect(
          buildAgentCommand('codex', { agentSettings: { codex: { mode: 'danger-full-access' } } }),
        ).toBe('codex --sandbox danger-full-access');
      });

      it('[FR-WORKSPACE-150] should omit --add-dir flags in the codex read-only preset', () => {
        expect(
          buildAgentCommand('codex', {
            additionalDirs: ['/some/dir'],
            agentSettings: { codex: { mode: 'read-only' } },
          }),
        ).toBe('codex --sandbox read-only');
      });
    });

    describe('mode helpers', () => {
      it('should expose per-agent mode lists with a valid default', () => {
        for (const agent of listAgentTypes()) {
          expect(agent.modes.length).toBeGreaterThan(0);
          expect(agent.modes.some((m) => m.id === agent.defaultModeId)).toBe(true);
        }
      });

      it('should recognize mode ids per agent', () => {
        expect(isAgentModeId('claude', 'plan')).toBe(true);
        expect(isAgentModeId('claude', 'read-only')).toBe(false);
        expect(isAgentModeId('codex', 'read-only')).toBe(true);
        expect(isAgentModeId('codex', 'plan')).toBe(false);
      });

      it('should resolve the configured mode, defaulting when unset or unknown', () => {
        expect(resolveAgentMode({ claude: { mode: 'auto' } }, 'claude')).toBe('auto');
        expect(resolveAgentMode({ claude: { mode: 'nope' } }, 'claude')).toBe('acceptEdits');
        expect(resolveAgentMode(undefined, 'codex')).toBe('workspace-write');
      });
    });

    describe('active flag', () => {
      it('should treat agents as active unless explicitly deactivated', () => {
        expect(isAgentActive(undefined, 'codex')).toBe(true);
        expect(isAgentActive({}, 'codex')).toBe(true);
        expect(isAgentActive({ codex: { mode: 'read-only' } }, 'codex')).toBe(true);
        expect(isAgentActive({ codex: { active: false } }, 'codex')).toBe(false);
        expect(isAgentActive({ codex: { active: true } }, 'codex')).toBe(true);
      });
    });

    describe('skills resolution', () => {
      it('[FR-WORKSPACE-160] should prefer the per-agent skill entry', () => {
        const workspace = {
          planSkill: '/legacy:plan',
          implementSkill: '/legacy:implement',
          agentSettings: { claude: { planSkill: '/mine:plan', implementSkill: '/mine:impl' } },
        };
        expect(resolveAgentSkills(workspace, 'claude')).toEqual({
          planSkill: '/mine:plan',
          implementSkill: '/mine:impl',
        });
      });

      it('[FR-WORKSPACE-160] should fall back to the legacy workspace columns', () => {
        const workspace = { planSkill: '/legacy:plan', implementSkill: null, agentSettings: {} };
        expect(resolveAgentSkills(workspace, 'claude')).toEqual({
          planSkill: '/legacy:plan',
          implementSkill: '/engy:implement',
        });
      });

      it('[FR-WORKSPACE-160] should fall back to the engy defaults when nothing is set', () => {
        expect(resolveAgentSkills({}, 'codex')).toEqual({
          planSkill: '/engy:plan',
          implementSkill: '/engy:implement',
        });
      });
    });
  });
});

describe('getMcpUrl', () => {
  it('should return undefined server-side (no window)', () => {
    expect(getMcpUrl()).toBeUndefined();
  });

  it('should embed the session placeholder in the per-session MCP path', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3123' } });
    try {
      expect(getMcpUrl()).toBe(`http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
