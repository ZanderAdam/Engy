import { describe, it, expect } from 'vitest';
import {
  buildAgentCommand,
  getAgentType,
  isAgentTypeId,
  listAgentTypes,
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
    it('should return bare codex when no options', () => {
      expect(buildAgentCommand('codex')).toBe('codex');
    });

    it('should include prompt when provided', () => {
      expect(buildAgentCommand('codex', { prompt: 'fix the tests' })).toBe("codex 'fix the tests'");
    });

    it('should fold system prompt into the prompt when both provided', () => {
      expect(
        buildAgentCommand('codex', { prompt: 'fix the tests', systemPrompt: 'Workspace: engy' }),
      ).toBe("codex 'Workspace: engy\n\nfix the tests'");
    });

    it('should skip the context block when no prompt (no burned turn)', () => {
      expect(buildAgentCommand('codex', { systemPrompt: 'Workspace: engy' })).toBe('codex');
    });

    it('should include add-dir flags when provided', () => {
      expect(buildAgentCommand('codex', { additionalDirs: ['/some/dir'] })).toBe(
        "codex --add-dir '/some/dir'",
      );
    });

    it('should register the Engy MCP server via -c config override when mcpUrl provided', () => {
      expect(buildAgentCommand('codex', { mcpUrl: 'http://localhost:3123/mcp' })).toBe(
        `codex -c 'mcp_servers.Engy.url="http://localhost:3123/mcp"'`,
      );
    });

    it('should use --dangerously-bypass-approvals-and-sandbox when skip flag set', () => {
      expect(buildAgentCommand('codex', { dangerouslySkipPermissions: true })).toBe(
        'codex --dangerously-bypass-approvals-and-sandbox',
      );
    });
  });
});
