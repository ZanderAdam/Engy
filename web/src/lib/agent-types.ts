import { buildAddDirFlags, shellEscape } from './shell';

export type AgentTypeId = 'claude' | 'codex';

interface BuildAgentCommandOptions {
  prompt?: string;
  systemPrompt?: string;
  additionalDirs?: string[];
  dangerouslySkipPermissions?: boolean;
  /** Engy MCP endpoint injected into the spawned CLI so it can call Engy tools. */
  mcpUrl?: string;
}

interface AgentType {
  id: AgentTypeId;
  label: string;
  buildCommand(options?: BuildAgentCommandOptions): string;
  /**
   * PTY paste mechanics for dispatch delivery. TUIs differ in how a bracketed
   * paste must be submitted: `submitDelayMs` is the wait between the paste and
   * the Enter key (an Enter sent too soon is swallowed by Ink-style renderers),
   * `enterCount` is how many Enter presses trigger submission after a paste.
   */
  paste: { enterCount: number; submitDelayMs: number };
}

/** MCP server name matching the README registration (`claude mcp add ... Engy`). */
const MCP_SERVER_NAME = 'Engy';

function claudeMcpFlag(mcpUrl: string): string {
  const config = JSON.stringify({
    mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl } },
  });
  return ` --mcp-config '${shellEscape(config)}'`;
}

const claude: AgentType = {
  id: 'claude',
  label: 'Claude',
  paste: { enterCount: 1, submitDelayMs: 350 },
  buildCommand(options) {
    let cmd = 'claude';
    if (options?.prompt) {
      cmd += ` '${shellEscape(options.prompt)}'`;
    }
    cmd += buildAddDirFlags(options?.additionalDirs ?? []);
    if (options?.systemPrompt) {
      cmd += ` --append-system-prompt '${shellEscape(options.systemPrompt)}'`;
    }
    if (options?.mcpUrl) {
      cmd += claudeMcpFlag(options.mcpUrl);
    }
    if (options?.dangerouslySkipPermissions) {
      cmd += ' --dangerously-skip-permissions';
    } else {
      cmd += ' --permission-mode acceptEdits';
    }
    return cmd;
  },
};

const codex: AgentType = {
  id: 'codex',
  label: 'Codex',
  paste: { enterCount: 1, submitDelayMs: 350 },
  buildCommand(options) {
    let cmd = 'codex';
    // Codex has no system-prompt flag — fold the context block into the
    // initial prompt when one exists. A context-only invocation would burn a
    // turn on the orientation text, so plain terminals skip it (codex picks up
    // repo context from AGENTS.md instead).
    const prompt =
      options?.prompt && options?.systemPrompt
        ? `${options.systemPrompt}\n\n${options.prompt}`
        : options?.prompt;
    if (prompt) {
      cmd += ` '${shellEscape(prompt)}'`;
    }
    cmd += buildAddDirFlags(options?.additionalDirs ?? []);
    if (options?.mcpUrl) {
      // Ephemeral config override — registers the Engy MCP server for this
      // invocation only, without touching ~/.codex/config.toml. The value is a
      // TOML string (inner double quotes), wrapped in a single-quoted shell arg,
      // so escape both layers.
      const tomlUrl = options.mcpUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      cmd += ` -c 'mcp_servers.${MCP_SERVER_NAME}.url="${shellEscape(tomlUrl)}"'`;
    }
    if (options?.dangerouslySkipPermissions) {
      cmd += ' --dangerously-bypass-approvals-and-sandbox';
    } else {
      // Codex defaults to a read-only sandbox, which both rejects --add-dir
      // (additional writable roots) and prevents editing. workspace-write is the
      // equivalent of Claude's acceptEdits: edit the workspace, still prompt for
      // anything outside it.
      cmd += ' --sandbox workspace-write';
    }
    return cmd;
  },
};

const AGENT_TYPES: Record<AgentTypeId, AgentType> = { claude, codex };

export function getAgentType(id: AgentTypeId | undefined): AgentType {
  return AGENT_TYPES[id ?? 'claude'];
}

export function listAgentTypes(): AgentType[] {
  return Object.values(AGENT_TYPES);
}

export function isAgentTypeId(value: string): value is AgentTypeId {
  return value in AGENT_TYPES;
}

/** Coerce a stored/user value to a valid agent id, defaulting to claude. */
export function coerceAgentTypeId(value: string | null | undefined): AgentTypeId {
  return value != null && isAgentTypeId(value) ? value : 'claude';
}

export function buildAgentCommand(
  agentType: AgentTypeId | undefined,
  options?: BuildAgentCommandOptions,
): string {
  return getAgentType(agentType).buildCommand(options);
}

/** Engy MCP endpoint of the server the browser is talking to (dev ports included). */
export function getMcpUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}/mcp`;
}
