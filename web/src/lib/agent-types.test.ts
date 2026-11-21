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
  toClaudeResumeCommand,
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
    it('[FR-TERMINAL-320] should include the session-id placeholder in claude commands', () => {
      expect(buildAgentCommand('claude')).toContain(`--session-id ${MCP_SESSION_PLACEHOLDER}`);
    });

    it('should return base command with permission mode and session-id when no options', () => {
      expect(buildAgentCommand('claude')).toBe(
        `claude --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
      );
    });

    it('should include prompt when provided', () => {
      expect(buildAgentCommand('claude', { prompt: 'Use /engy:plan to plan engy-T1' })).toBe(
        `claude 'Use /engy:plan to plan engy-T1' --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
      );
    });

    it('should include add-dir flags when provided', () => {
      expect(buildAgentCommand('claude', { additionalDirs: ['/some/dir'] })).toBe(
        `claude --add-dir '/some/dir' --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
      );
    });

    it('should escape single quotes in prompt', () => {
      expect(buildAgentCommand('claude', { prompt: "it's a test" })).toBe(
        `claude 'it'\\''s a test' --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
      );
    });

    it('should include --append-system-prompt when systemPrompt provided', () => {
      expect(buildAgentCommand('claude', { systemPrompt: 'Workspace: engy (id: 1)' })).toBe(
        `claude --append-system-prompt 'Workspace: engy (id: 1)' --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
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
        `claude 'Use /engy:plan' --add-dir '/repo' --append-system-prompt 'Workspace: engy (id: 1)' --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
      );
    });

    it('should use --dangerously-skip-permissions instead of --permission-mode when flag set', () => {
      expect(buildAgentCommand('claude', { dangerouslySkipPermissions: true })).toBe(
        `claude --dangerously-skip-permissions --session-id ${MCP_SESSION_PLACEHOLDER}`,
      );
    });

    describe('Engy session mod env', () => {
      const mcpUrl = `http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`;

      it('[FR-TERMINAL-610] should prefix ENGY_MCP_URL and ENGY_HOOK_URL, derived from the MCP URL, instead of --mcp-config', () => {
        expect(buildAgentCommand('claude', { mcpUrl })).toBe(
          `ENGY_MCP_URL='${mcpUrl}' ENGY_HOOK_URL='http://localhost:3123/hooks/${MCP_SESSION_PLACEHOLDER}' claude --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
        );
      });

      it('[FR-TERMINAL-610] should start with plain claude when mcpUrl is not provided', () => {
        expect(buildAgentCommand('claude', { prompt: 'hi' })).toBe(
          `claude 'hi' --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
        );
      });

      it('[FR-TERMINAL-610] should survive MCP_SESSION_PLACEHOLDER substitution', () => {
        const sessionId = 'a1b2c3d4-real-session';
        const resolved = buildAgentCommand('claude', { mcpUrl }).replaceAll(
          MCP_SESSION_PLACEHOLDER,
          sessionId,
        );
        expect(resolved).toContain(`ENGY_HOOK_URL='http://localhost:3123/hooks/${sessionId}'`);
        expect(resolved).not.toContain(MCP_SESSION_PLACEHOLDER);
      });

      it('should shell-escape a single quote in the hook URL', () => {
        const cmd = buildAgentCommand('claude', {
          mcpUrl: "http://localhost:3123/mcp/it's-a-session",
        });
        expect(cmd).toContain("ENGY_HOOK_URL='http://localhost:3123/hooks/it'\\''s-a-session'");
      });

      it('[FR-MEMORY-300] should omit ENGY_MEMORY_CAPTURE when memoryCapture is not set', () => {
        expect(buildAgentCommand('claude', { mcpUrl })).not.toContain('ENGY_MEMORY_CAPTURE');
      });

      it('[FR-MEMORY-300] should set ENGY_MEMORY_CAPTURE=1 when the workspace setting is on', () => {
        const cmd = buildAgentCommand('claude', {
          mcpUrl,
          agentSettings: { claude: { memoryCapture: true } },
        });
        expect(cmd).toContain('ENGY_MEMORY_CAPTURE=1 claude');
      });

      it('[FR-TERMINAL-610] should keep the hook URL and the /mcp/<sessionId> match through restart-adoption', () => {
        const sessionId = 'a1b2c3d4-real-session';
        const fresh = buildAgentCommand('claude', {
          mcpUrl: `http://localhost:3123/mcp/${sessionId}`,
        }).replace(`--session-id ${MCP_SESSION_PLACEHOLDER}`, `--session-id ${sessionId}`);
        const adopted = toClaudeResumeCommand(fresh);
        // hasSessionEndpoint() in terminal-dispatch.ts matches this exact substring.
        expect(adopted).toContain(`/mcp/${sessionId}`);
        expect(adopted).toContain(`http://localhost:3123/hooks/${sessionId}`);
        expect(adopted).toContain('--resume');
        expect(adopted).not.toContain('--session-id');
      });
    });

    describe('resume', () => {
      it('[FR-TERMINAL-320] should not emit --session-id when resuming', () => {
        const cmd = buildAgentCommand('claude', { resumeSessionId: 'abc-123' });
        expect(cmd).not.toContain('--session-id');
      });

      it('should emit --resume with the session id when resumeSessionId is provided', () => {
        expect(buildAgentCommand('claude', { resumeSessionId: 'abc-123' })).toBe(
          "claude --resume 'abc-123' --permission-mode acceptEdits",
        );
      });

      it('should emit bare --resume (picker) when resumeSessionId is empty string', () => {
        expect(buildAgentCommand('claude', { resumeSessionId: '' })).toBe(
          'claude --resume --permission-mode acceptEdits',
        );
      });

      it('should include the Engy env and permission mode when resuming but omit prompt and systemPrompt', () => {
        const cmd = buildAgentCommand('claude', {
          resumeSessionId: 'abc-123',
          prompt: 'ignored prompt',
          systemPrompt: 'ignored system',
          mcpUrl: 'http://localhost:3123/mcp',
        });
        expect(cmd).toContain("--resume 'abc-123'");
        expect(cmd).toContain("ENGY_MCP_URL='http://localhost:3123/mcp'");
        expect(cmd).toContain('--permission-mode acceptEdits');
        expect(cmd).not.toContain('ignored prompt');
        expect(cmd).not.toContain('ignored system');
        expect(cmd).not.toContain('--session-id');
      });

      it('[FR-TERMINAL-610] should prefix ENGY_HOOK_URL on the --resume branch too', () => {
        const cmd = buildAgentCommand('claude', {
          resumeSessionId: 'abc-123',
          mcpUrl: 'http://localhost:3123/mcp/abc-123',
        });
        expect(cmd).toContain(
          "ENGY_HOOK_URL='http://localhost:3123/hooks/abc-123' claude --resume",
        );
      });

      it('[FR-TERMINAL-360] should re-issue --add-dir grants when resuming', () => {
        expect(
          buildAgentCommand('claude', {
            resumeSessionId: 'abc-123',
            additionalDirs: ['/some/dir'],
          }),
        ).toBe("claude --resume 'abc-123' --add-dir '/some/dir' --permission-mode acceptEdits");
      });

      it('should use --dangerously-skip-permissions when resuming with dangerouslySkipPermissions', () => {
        expect(
          buildAgentCommand('claude', {
            resumeSessionId: 'abc-123',
            dangerouslySkipPermissions: true,
          }),
        ).toBe("claude --resume 'abc-123' --dangerously-skip-permissions");
      });
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

    it('[FR-TERMINAL-610] should never emit the Engy session env, even with memory capture on', () => {
      const cmd = buildAgentCommand('codex', {
        mcpUrl: 'http://localhost:3123/mcp',
        agentSettings: { claude: { memoryCapture: true } },
      });
      expect(cmd).not.toContain('ENGY_');
    });

    it('should use --dangerously-bypass-approvals-and-sandbox instead of the sandbox flag when skip set', () => {
      expect(buildAgentCommand('codex', { dangerouslySkipPermissions: true })).toBe(
        'codex --dangerously-bypass-approvals-and-sandbox',
      );
    });

    describe('resume', () => {
      it('should emit codex resume with session id when resumeSessionId is provided', () => {
        expect(buildAgentCommand('codex', { resumeSessionId: 'abc-123' })).toBe(
          "codex resume 'abc-123'",
        );
      });

      it('should emit bare codex resume (picker) when resumeSessionId is empty string', () => {
        expect(buildAgentCommand('codex', { resumeSessionId: '' })).toBe('codex resume');
      });

      it('should omit all sandbox/mcp flags when resuming codex', () => {
        const cmd = buildAgentCommand('codex', {
          resumeSessionId: 'abc-123',
          mcpUrl: 'http://localhost:3123/mcp',
          dangerouslySkipPermissions: true,
        });
        expect(cmd).toBe("codex resume 'abc-123'");
        expect(cmd).not.toContain('--sandbox');
        expect(cmd).not.toContain('--mcp');
      });
    });
  });

  describe('per-agent workspace settings', () => {
    describe('mode in built commands', () => {
      it('[FR-WORKSPACE-150] should apply the configured claude permission mode', () => {
        expect(buildAgentCommand('claude', { agentSettings: { claude: { mode: 'plan' } } })).toBe(
          `claude --permission-mode plan --session-id ${MCP_SESSION_PLACEHOLDER}`,
        );
      });

      it('[FR-WORKSPACE-150] should fall back to acceptEdits for an unknown claude mode', () => {
        expect(buildAgentCommand('claude', { agentSettings: { claude: { mode: 'yolo' } } })).toBe(
          `claude --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`,
        );
      });

      it("[FR-WORKSPACE-150] should ignore the OTHER agent's configured mode", () => {
        expect(
          buildAgentCommand('claude', { agentSettings: { codex: { mode: 'read-only' } } }),
        ).toBe(`claude --permission-mode acceptEdits --session-id ${MCP_SESSION_PLACEHOLDER}`);
      });

      it('[FR-WORKSPACE-150] should let permission-bypass (container) override the configured mode', () => {
        expect(
          buildAgentCommand('claude', {
            dangerouslySkipPermissions: true,
            agentSettings: { claude: { mode: 'plan' } },
          }),
        ).toBe(`claude --dangerously-skip-permissions --session-id ${MCP_SESSION_PLACEHOLDER}`);
      });

      it('[FR-WORKSPACE-150] should map the codex full-auto preset to sandbox + approval flags', () => {
        expect(
          buildAgentCommand('codex', { agentSettings: { codex: { mode: 'full-auto' } } }),
        ).toBe('codex --sandbox workspace-write --ask-for-approval never');
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
        expect(isAgentModeId('claude', 'auto')).toBe(true);
        expect(isAgentModeId('claude', 'dontAsk')).toBe(false);
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

describe('toClaudeResumeCommand', () => {
  it('[FR-TERMINAL-380] should rewrite --session-id to --resume for a bare token', () => {
    expect(
      toClaudeResumeCommand('claude --permission-mode acceptEdits --session-id __ENGY_SESSION__'),
    ).toBe('claude --permission-mode acceptEdits --resume __ENGY_SESSION__');
  });

  it('[FR-TERMINAL-380] should rewrite --session-id to --resume for a single-quoted token', () => {
    expect(
      toClaudeResumeCommand("claude --session-id 'some-uuid-123' --permission-mode auto"),
    ).toBe("claude --resume 'some-uuid-123' --permission-mode auto");
  });

  it('[FR-TERMINAL-380] should return the command unchanged when --session-id is absent', () => {
    const cmd = 'claude --resume abc-123 --permission-mode acceptEdits';
    expect(toClaudeResumeCommand(cmd)).toBe(cmd);
  });

  it('[FR-TERMINAL-380] should drop the prompt and keep all other flags verbatim', () => {
    const result = toClaudeResumeCommand(
      "claude 'my prompt' --add-dir '/repo' --permission-mode plan --session-id my-id",
    );
    expect(result).toBe("claude --add-dir '/repo' --permission-mode plan --resume my-id");
  });

  it('[FR-TERMINAL-380] should drop a prompt that contains quotes and keep the system prompt', () => {
    const fresh = buildAgentCommand('claude', {
      prompt: "/engy:plan task 'it''s'\n--session-id fake '",
      systemPrompt: "Engy context: don't resend",
      additionalDirs: ['/docs'],
    }).replace(`--session-id ${MCP_SESSION_PLACEHOLDER}`, '--session-id real-id');

    const resumed = toClaudeResumeCommand(fresh);

    expect(resumed).not.toContain('/engy:plan');
    expect(resumed).toMatch(/^claude --add-dir /);
    expect(resumed).toContain(`--append-system-prompt 'Engy context: don'\\''t resend'`);
    expect(resumed).toContain('--resume real-id');
    expect(resumed).not.toContain('--session-id');
  });

  it('[FR-TERMINAL-380] should drop the prompt after the Engy env prefix and keep the prefix', () => {
    const fresh = buildAgentCommand('claude', {
      prompt: '/engy:plan task',
      mcpUrl: `http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`,
    }).replace(`--session-id ${MCP_SESSION_PLACEHOLDER}`, '--session-id real-id');

    const resumed = toClaudeResumeCommand(fresh);

    expect(resumed).not.toContain('/engy:plan');
    expect(resumed).toMatch(
      /^ENGY_MCP_URL='[^']+' ENGY_HOOK_URL='[^']+' claude --permission-mode acceptEdits --resume real-id$/,
    );
  });

  it('[FR-TERMINAL-380] should keep the prompt when --session-id is absent', () => {
    const cmd = "claude 'my prompt' --permission-mode plan";
    expect(toClaudeResumeCommand(cmd)).toBe(cmd);
  });
});
