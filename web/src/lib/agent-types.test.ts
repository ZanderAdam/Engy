import { describe, it, expect, vi } from 'vitest';
import {
  buildAgentCommand,
  buildHookSettings,
  coerceAgentTypeId,
  getAgentType,
  getMcpUrl,
  isAgentTypeId,
  isAgentActive,
  isAgentModeId,
  listAgentTypes,
  resolveAgentMode,
  resolveAgentSkills,
  sessionIdFlagToResume,
  MCP_SESSION_PLACEHOLDER,
} from './agent-types';

/**
 * Pulls the `--settings '<json>'` argument out of a built command string and
 * reverses `shellEscape`'s `'\''` encoding, without assuming --settings is
 * the last flag (later flags like --permission-mode follow it).
 */
function extractSettingsBlob(cmd: string): {
  hooks: Record<string, { hooks: Record<string, unknown>[] }[]>;
} {
  const marker = "--settings '";
  const start = cmd.indexOf(marker);
  if (start === -1) throw new Error('--settings not found in command');
  let i = start + marker.length;
  let raw = '';
  while (i < cmd.length) {
    if (cmd.startsWith("'\\''", i)) {
      raw += "'";
      i += 4;
      continue;
    }
    if (cmd[i] === "'") break;
    raw += cmd[i];
    i++;
  }
  return JSON.parse(raw);
}

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

    it('should register the Engy MCP server via --mcp-config when mcpUrl provided', () => {
      const cmd = buildAgentCommand('claude', { mcpUrl: 'http://localhost:3123/mcp' });
      expect(cmd).toContain('--mcp-config');
      expect(cmd).toContain('"Engy"');
      expect(cmd).toContain('"http://localhost:3123/mcp"');
      expect(cmd).toContain('"type":"http"');
      expect(cmd).toContain(`--session-id ${MCP_SESSION_PLACEHOLDER}`);
    });

    describe('hook channel (--settings)', () => {
      it('[FR-TERMINAL-610][FR-TERMINAL-630] should register the hook channel via --settings when mcpUrl provided', () => {
        const cmd = buildAgentCommand('claude', {
          mcpUrl: `http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`,
        });
        expect(cmd).toContain('--settings');
        expect(cmd).toContain(`http://localhost:3123/hooks/${MCP_SESSION_PLACEHOLDER}`);
        expect(cmd).not.toContain(`http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}/hooks`);
      });

      it('[FR-TERMINAL-610] should omit --settings when mcpUrl is not provided', () => {
        const cmd = buildAgentCommand('claude', { prompt: 'hi' });
        expect(cmd).not.toContain('--settings');
      });

      it('[FR-TERMINAL-610] should survive MCP_SESSION_PLACEHOLDER substitution', () => {
        const cmd = buildAgentCommand('claude', {
          mcpUrl: `http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`,
        });
        const sessionId = 'a1b2c3d4-real-session';
        const resolved = cmd.replaceAll(MCP_SESSION_PLACEHOLDER, sessionId);
        expect(resolved).toContain(`http://localhost:3123/hooks/${sessionId}`);
        expect(resolved).not.toContain(MCP_SESSION_PLACEHOLDER);
      });

      it('[TG6] should omit PreCompact/SessionEnd from --settings when memoryCapture is not set', () => {
        const cmd = buildAgentCommand('claude', {
          mcpUrl: `http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`,
        });
        const settings = extractSettingsBlob(cmd);
        expect(settings.hooks.PreCompact).toBeUndefined();
        expect(settings.hooks.SessionEnd).toBeUndefined();
      });

      it('[TG6] should include PreCompact/SessionEnd command hooks when the workspace setting is on', () => {
        const cmd = buildAgentCommand('claude', {
          mcpUrl: `http://localhost:3123/mcp/${MCP_SESSION_PLACEHOLDER}`,
          agentSettings: { claude: { memoryCapture: true } },
        });
        const settings = extractSettingsBlob(cmd);
        expect(settings.hooks.PreCompact[0].hooks[0].type).toBe('command');
        expect(settings.hooks.SessionEnd[0].hooks[0].type).toBe('command');
      });

      it('[TG6] should keep memory capture off for codex — hooks are claude-only regardless of the setting', () => {
        const cmd = buildAgentCommand('codex', {
          mcpUrl: 'http://localhost:3123/mcp',
          agentSettings: { claude: { memoryCapture: true } },
        });
        expect(cmd).not.toContain('--settings');
      });

      it('should shell-escape a single quote in the SessionStart curl command hookUrl', () => {
        const settings = JSON.parse(
          buildHookSettings("http://localhost:3123/hooks/it's-a-session", false),
        );
        const command = settings.hooks.SessionStart[0].hooks[0].command as string;
        expect(command).toContain("http://localhost:3123/hooks/it'\\''s-a-session");
      });

      it('[FR-TERMINAL-610] should keep the hook URL and the /mcp/<sessionId> match through restart-adoption', () => {
        const sessionId = 'a1b2c3d4-real-session';
        const fresh = buildAgentCommand('claude', {
          mcpUrl: `http://localhost:3123/mcp/${sessionId}`,
        }).replace(`--session-id ${MCP_SESSION_PLACEHOLDER}`, `--session-id ${sessionId}`);
        const adopted = sessionIdFlagToResume(fresh);
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

      it('should include --mcp-config and permission mode when resuming but omit prompt and systemPrompt', () => {
        const cmd = buildAgentCommand('claude', {
          resumeSessionId: 'abc-123',
          prompt: 'ignored prompt',
          systemPrompt: 'ignored system',
          mcpUrl: 'http://localhost:3123/mcp',
        });
        expect(cmd).toContain("--resume 'abc-123'");
        expect(cmd).toContain('--mcp-config');
        expect(cmd).toContain('--permission-mode acceptEdits');
        expect(cmd).not.toContain('ignored prompt');
        expect(cmd).not.toContain('ignored system');
        expect(cmd).not.toContain('--session-id');
      });

      it('[FR-TERMINAL-610] should include --settings on the --resume branch too', () => {
        const cmd = buildAgentCommand('claude', {
          resumeSessionId: 'abc-123',
          mcpUrl: 'http://localhost:3123/mcp/abc-123',
        });
        expect(cmd).toContain('--settings');
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

    it('[FR-TERMINAL-610] should never emit --settings (hooks are claude-only)', () => {
      expect(buildAgentCommand('codex', { mcpUrl: 'http://localhost:3123/mcp' })).not.toContain(
        '--settings',
      );
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

describe('buildHookSettings', () => {
  const MEMORY_CAPTURE_EVENTS = ['PreCompact', 'SessionEnd'];
  const ALWAYS_ON_EVENTS = [
    'SessionStart',
    'UserPromptSubmit',
    'Stop',
    'StopFailure',
    'Notification',
    'SubagentStart',
    'SubagentStop',
  ];
  const ALL_EVENTS = [...ALWAYS_ON_EVENTS, ...MEMORY_CAPTURE_EVENTS];

  function parse(
    hookUrl = 'http://localhost:3123/hooks/session-1',
    memoryCaptureEnabled = false,
  ) {
    return JSON.parse(buildHookSettings(hookUrl, memoryCaptureEnabled)) as {
      hooks: Record<string, { hooks: Record<string, unknown>[] }[]>;
    };
  }

  it('[FR-TERMINAL-610] should register the nine always-on events, memory capture off by default', () => {
    const { hooks } = parse();
    expect(Object.keys(hooks).sort()).toEqual([...ALWAYS_ON_EVENTS].sort());
  });

  it('[memory capture gating] should register all eleven events when memory capture is enabled', () => {
    const { hooks } = parse(undefined, true);
    expect(Object.keys(hooks).sort()).toEqual([...ALL_EVENTS].sort());
  });

  const HTTP_EVENTS = ALWAYS_ON_EVENTS.filter((event) => event !== 'SessionStart');

  it('[FR-TERMINAL-610] should register one match-all http handler per event, url wired to the hook endpoint', () => {
    const { hooks } = parse('http://localhost:3123/hooks/session-1');
    for (const event of HTTP_EVENTS) {
      expect(hooks[event]).toHaveLength(1);
      expect(hooks[event][0].hooks).toHaveLength(1);
      const handler = hooks[event][0].hooks[0] as Record<string, unknown>;
      expect(handler.type).toBe('http');
      expect(handler.url).toBe('http://localhost:3123/hooks/session-1');
      expect(handler.matcher).toBeUndefined();
    }
  });

  it('[FR-TERMINAL-610] should register SessionStart as a command hook that curls the hook endpoint, not http', () => {
    const { hooks } = parse('http://localhost:3123/hooks/session-1');
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionStart[0].hooks).toHaveLength(1);
    const handler = hooks.SessionStart[0].hooks[0] as Record<string, unknown>;
    expect(handler.type).toBe('command');
    expect(handler.url).toBeUndefined();
    expect(handler.command).toContain('curl');
    expect(handler.command).toContain("'http://localhost:3123/hooks/session-1'");
    expect(handler.matcher).toBeUndefined();
  });

  it('[FR-TERMINAL-610] SessionStart command should parse as valid JSON end to end and stay one shell token', () => {
    const settingsJson = buildHookSettings('http://localhost:3123/hooks/session-1', false);
    const reparsed = JSON.parse(settingsJson) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[] };
    };
    const command = reparsed.hooks.SessionStart[0].hooks[0].command;
    expect(command).toBe(
      "curl -s -m 5 -X POST 'http://localhost:3123/hooks/session-1' -H 'Content-Type: application/json' -d @-",
    );
  });

  it('[FR-TERMINAL-620] should give every handler an explicit timeout well below the 600s default', () => {
    const { hooks } = parse(undefined, true);
    for (const event of ALL_EVENTS) {
      const handler = hooks[event][0].hooks[0] as Record<string, unknown>;
      expect(typeof handler.timeout).toBe('number');
      expect(handler.timeout).toBeGreaterThan(0);
      expect(handler.timeout as number).toBeLessThan(600);
    }
  });

  it('[FR-TERMINAL-620] should never emit an async field — http hooks have no fire-and-forget mode', () => {
    const { hooks } = parse();
    for (const event of HTTP_EVENTS) {
      const handler = hooks[event][0].hooks[0] as Record<string, unknown>;
      expect(handler.async).toBeUndefined();
      expect('asyncRewake' in handler).toBe(false);
    }
  });

  describe('[TG6] PreCompact/SessionEnd memory capture gating', () => {
    it('[FR-MEMORY-300] should register both as command hooks pointed at the nested capture script when enabled', () => {
      const { hooks } = parse('http://localhost:3123/hooks/session-1', true);
      for (const event of MEMORY_CAPTURE_EVENTS) {
        expect(hooks[event]).toHaveLength(1);
        expect(hooks[event][0].hooks).toHaveLength(1);
        const handler = hooks[event][0].hooks[0] as Record<string, unknown>;
        expect(handler.type).toBe('command');
        expect(handler.url).toBeUndefined();
        expect(handler.command).toContain('nohup');
        expect(handler.command).toContain('disown');
        expect(handler.command).toContain('http://localhost:3123/hooks/session-1');
        // Security fix: the nested job has no MCP access at all, so no
        // allow/deny list on MCP tools is even relevant.
        expect(handler.command).not.toContain('--mcp-config');
        expect(handler.command).not.toContain('--strict-mcp-config');
      }
    });

    it('should omit PreCompact and SessionEnd entirely — not register a no-op — when disabled', () => {
      const { hooks } = parse('http://localhost:3123/hooks/session-1', false);
      expect(hooks.PreCompact).toBeUndefined();
      expect(hooks.SessionEnd).toBeUndefined();
    });
  });
});

describe('sessionIdFlagToResume', () => {
  it('[FR-TERMINAL-380] should rewrite --session-id to --resume for a bare token', () => {
    expect(
      sessionIdFlagToResume('claude --permission-mode acceptEdits --session-id __ENGY_SESSION__'),
    ).toBe('claude --permission-mode acceptEdits --resume __ENGY_SESSION__');
  });

  it('[FR-TERMINAL-380] should rewrite --session-id to --resume for a single-quoted token', () => {
    expect(
      sessionIdFlagToResume("claude --session-id 'some-uuid-123' --permission-mode auto"),
    ).toBe("claude --resume 'some-uuid-123' --permission-mode auto");
  });

  it('[FR-TERMINAL-380] should return the command unchanged when --session-id is absent', () => {
    const cmd = 'claude --resume abc-123 --permission-mode acceptEdits';
    expect(sessionIdFlagToResume(cmd)).toBe(cmd);
  });

  it('[FR-TERMINAL-380] should preserve all surrounding flags verbatim', () => {
    const result = sessionIdFlagToResume(
      "claude 'my prompt' --add-dir '/repo' --permission-mode plan --session-id my-id",
    );
    expect(result).toBe(
      "claude 'my prompt' --add-dir '/repo' --permission-mode plan --resume my-id",
    );
  });
});
