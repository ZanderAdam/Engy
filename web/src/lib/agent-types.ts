import { buildAddDirFlags, shellEscape } from './shell';
import { buildMemoryCaptureCommand } from '../server/hooks/memory';

export type AgentTypeId = 'claude' | 'codex';

/**
 * Per-agent workspace overrides, stored as a JSON column on the workspaces
 * table (`agent_settings`). Keyed by agent type id as plain strings so adding
 * an agent needs only a registry entry, never a schema migration.
 */
export interface AgentSettings {
  /** false hides the agent from terminal pickers and refuses terminal_spawn. */
  active?: boolean;
  /** Mode id from the agent's registry `modes` list; unknown ids fall back to the default. */
  mode?: string;
  planSkill?: string | null;
  implementSkill?: string | null;
  /**
   * Registers the PreCompact/SessionEnd memory-capture hooks (off by
   * default). Each firing is a real, billed model call — measured $0.34 on a
   * near-empty transcript, scaling with transcript size — so this rides the
   * same per-agent settings blob every other agent toggle already reaches
   * every spawn call site through, rather than a new top-level workspace
   * column that would need threading into each one individually.
   */
  memoryCapture?: boolean;
}

export type WorkspaceAgentSettings = Partial<Record<string, AgentSettings>>;

interface AgentMode {
  id: string;
  label: string;
  description: string;
}

interface BuildAgentCommandOptions {
  prompt?: string;
  systemPrompt?: string;
  additionalDirs?: string[];
  dangerouslySkipPermissions?: boolean;
  /** Engy MCP endpoint injected into the spawned CLI so it can call Engy tools. */
  mcpUrl?: string;
  /** Workspace per-agent overrides — the command picks up its own agent's mode. */
  agentSettings?: WorkspaceAgentSettings | null;
  /**
   * Resume a previous agent-CLI conversation. Non-empty = resume that session id;
   * empty string = open the CLI's interactive resume picker. When set,
   * prompt/systemPrompt are ignored (the resumed conversation already has its context).
   */
  resumeSessionId?: string;
  /**
   * Session display name for `claude --name` (prompt box, /resume picker,
   * terminal title). Claude-only; other agent builders ignore it.
   */
  displayName?: string;
}

interface AgentType {
  id: AgentTypeId;
  label: string;
  modes: AgentMode[];
  defaultModeId: string;
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

// The command is built before the terminal's sessionId exists, so getMcpUrl
// emits a placeholder in the per-session MCP path; the terminal server swaps in
// the real sessionId at spawn time. That id becomes the agent's identity — every
// tool call it makes arrives at /mcp/<sessionId>, so the server knows who's
// calling (and thus its agent type). See web/src/server/ws/terminal-server.ts.
export const MCP_SESSION_PLACEHOLDER = '__ENGY_SESSION__';

function claudeNameFlag(displayName: string): string {
  return ` --name '${shellEscape(displayName)}'`;
}

/** `--name` value: project + scope for project-scoped terminals, scope alone for workspace-scoped ones. */
export function composeDisplayName(scopeLabel: string | undefined): string | undefined {
  return scopeLabel || undefined;
}

const CLAUDE_COMMAND_RE = /^claude(\s|$)/;

/**
 * Appends `--name` to an already-built claude command string. The terminal
 * server receives commands the browser already built via buildAgentCommand —
 * it can only post-process them, not rebuild through claudeSharedFlags.
 */
export function appendClaudeNameFlag(
  command: string | undefined,
  displayName: string | undefined,
): string | undefined {
  if (!command || !displayName || !CLAUDE_COMMAND_RE.test(command)) return command;
  return `${command}${claudeNameFlag(displayName)}`;
}

function claudeMcpFlag(mcpUrl: string): string {
  const config = JSON.stringify({
    mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl } },
  });
  return ` --mcp-config '${shellEscape(config)}'`;
}

// Hook events this milestone wires up. Registered with matcher omitted
// (match-all) and routed server-side by hook_event_name — one URL for all
// eleven avoids a config that must change (and force a respawn) every time
// a new event's handler ships in a later task group.
const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Notification',
  'SessionEnd',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
  'WorktreeCreate',
  'WorktreeRemove',
] as const;

// `async`/`asyncRewake` only apply to `command`-type hooks — an `http`
// handler has no fire-and-forget mode and always sits in the turn's
// critical path, awaited up to `timeout`. That makes an explicit short
// timeout on every handler load-bearing rather than a nicety.
const HOOK_TIMEOUT_SECONDS = 5;

// claude 2.1.251 silently drops `type: "http"` hooks registered for
// SessionStart (logs "Skipping HTTP hook ... not supported for SessionStart")
// — confirmed by probe, so this event alone runs as a `command` hook that
// curls the same endpoint and echoes its response on stdout.
function sessionStartHookCommand(hookUrl: string): string {
  return `curl -s -m ${HOOK_TIMEOUT_SECONDS} -X POST '${shellEscape(hookUrl)}' -H 'Content-Type: application/json' -d @-`;
}

const MEMORY_CAPTURE_EVENTS = new Set(['PreCompact', 'SessionEnd']);

/**
 * Inline per-session `--settings` payload registering the Engy hook channel
 * for every event this milestone uses. Never written to
 * plugins/engy/hooks/hooks.json or any settings.json — the Engy plugin is
 * enabled user-wide, so a hook placed there would fire in every Claude
 * session on the machine, not just ones Engy spawned.
 *
 * PreCompact/SessionEnd are omitted entirely — not registered as a no-op —
 * when `memoryCaptureEnabled` is false: each firing is a billed model call
 * (TG6 spike), so an unused registration still costing a round trip per
 * event is not acceptable for a feature nobody opted into.
 */
export function buildHookSettings(hookUrl: string, memoryCaptureEnabled: boolean): string {
  const hooks: Record<string, unknown> = {};
  for (const event of HOOK_EVENTS) {
    if (MEMORY_CAPTURE_EVENTS.has(event)) {
      if (!memoryCaptureEnabled) continue;
      hooks[event] = [
        {
          hooks: [
            {
              type: 'command',
              command: buildMemoryCaptureCommand(hookUrl),
              timeout: HOOK_TIMEOUT_SECONDS,
            },
          ],
        },
      ];
      continue;
    }
    hooks[event] =
      event === 'SessionStart'
        ? [
            {
              hooks: [
                {
                  type: 'command',
                  command: sessionStartHookCommand(hookUrl),
                  timeout: HOOK_TIMEOUT_SECONDS,
                },
              ],
            },
          ]
        : [{ hooks: [{ type: 'http', url: hookUrl, timeout: HOOK_TIMEOUT_SECONDS }] }];
  }
  return JSON.stringify({ hooks });
}

function claudeHooksFlag(mcpUrl: string, memoryCaptureEnabled: boolean): string {
  const hookUrl = mcpUrl.replace('/mcp/', '/hooks/');
  const settings = buildHookSettings(hookUrl, memoryCaptureEnabled);
  return ` --settings '${shellEscape(settings)}'`;
}

const CLAUDE_DEFAULT_MODE_ID = 'acceptEdits';

// The CLI also accepts `dontAsk` (deny everything not explicitly allowlisted,
// no prompting) — deliberately not offered: it is a CI/allowlist mode that
// would make an interactive Engy terminal silently refuse every action.
const CLAUDE_MODES: AgentMode[] = [
  { id: 'default', label: 'Default', description: 'Prompt on first use of each tool' },
  {
    id: 'acceptEdits',
    label: 'Accept edits',
    description: 'Auto-accept edits in the working directory',
  },
  { id: 'plan', label: 'Plan', description: 'Read-only analysis and planning' },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Claude decides; a safety classifier blocks destructive actions',
  },
  {
    id: 'bypassPermissions',
    label: 'Bypass permissions',
    description: 'Approve everything without prompting',
  },
];

function coerceModeId(modes: AgentMode[], defaultModeId: string, mode: string | undefined): string {
  return mode && modes.some((m) => m.id === mode) ? mode : defaultModeId;
}

/** MCP + permission flags shared by claude's fresh-spawn and resume commands. */
function claudeSharedFlags(options?: BuildAgentCommandOptions): string {
  let cmd = '';
  if (options?.displayName) {
    cmd += claudeNameFlag(options.displayName);
  }
  if (options?.mcpUrl) {
    cmd += claudeMcpFlag(options.mcpUrl);
    cmd += claudeHooksFlag(options.mcpUrl, options?.agentSettings?.claude?.memoryCapture ?? false);
  }
  if (options?.dangerouslySkipPermissions) {
    cmd += ' --dangerously-skip-permissions';
  } else {
    const mode = coerceModeId(
      CLAUDE_MODES,
      CLAUDE_DEFAULT_MODE_ID,
      options?.agentSettings?.claude?.mode,
    );
    cmd += ` --permission-mode ${mode}`;
  }
  return cmd;
}

const claude: AgentType = {
  id: 'claude',
  label: 'Claude',
  modes: CLAUDE_MODES,
  defaultModeId: CLAUDE_DEFAULT_MODE_ID,
  paste: { enterCount: 1, submitDelayMs: 350 },
  buildCommand(options) {
    const resumeSessionId = options?.resumeSessionId;

    if (resumeSessionId !== undefined) {
      // Resumed conversations carry their own context — prompt and system
      // prompt are dropped, but runtime grants (dirs, MCP, permissions) are not
      // part of the conversation and must be re-issued.
      let cmd = 'claude --resume';
      if (resumeSessionId !== '') {
        cmd += ` '${shellEscape(resumeSessionId)}'`;
      }
      cmd += buildAddDirFlags(options?.additionalDirs ?? []);
      cmd += claudeSharedFlags(options);
      return cmd;
    }

    let cmd = 'claude';
    if (options?.prompt) {
      cmd += ` '${shellEscape(options.prompt)}'`;
    }
    cmd += buildAddDirFlags(options?.additionalDirs ?? []);
    if (options?.systemPrompt) {
      cmd += ` --append-system-prompt '${shellEscape(options.systemPrompt)}'`;
    }
    cmd += claudeSharedFlags(options);
    cmd += ` --session-id ${MCP_SESSION_PLACEHOLDER}`;
    return cmd;
  },
};

// Codex splits autonomy across two flags (--sandbox and --ask-for-approval);
// the dropdown exposes single presets so it mirrors Claude's one-mode UX.
const CODEX_MODES: AgentMode[] = [
  { id: 'read-only', label: 'Read only', description: 'Analyse without writing' },
  {
    id: 'workspace-write',
    label: 'Workspace write',
    description: 'Edit the workspace, ask beyond it',
  },
  { id: 'full-auto', label: 'Full auto', description: 'Workspace write, never ask for approval' },
  { id: 'danger-full-access', label: 'Full access', description: 'No sandbox — dangerous' },
];

const CODEX_MODE_FLAGS: Record<string, string> = {
  'read-only': ' --sandbox read-only',
  'workspace-write': ' --sandbox workspace-write',
  'full-auto': ' --sandbox workspace-write --ask-for-approval never',
  'danger-full-access': ' --sandbox danger-full-access',
};

const codex: AgentType = {
  id: 'codex',
  label: 'Codex',
  modes: CODEX_MODES,
  // workspace-write is the equivalent of Claude's acceptEdits: edit the
  // workspace, still prompt for anything outside it.
  defaultModeId: 'workspace-write',
  paste: { enterCount: 1, submitDelayMs: 350 },
  buildCommand(options) {
    const resumeSessionId = options?.resumeSessionId;

    if (resumeSessionId !== undefined) {
      if (resumeSessionId !== '') {
        return `codex resume '${shellEscape(resumeSessionId)}'`;
      }
      return 'codex resume';
    }

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
    const mode = coerceModeId(
      CODEX_MODES,
      this.defaultModeId,
      options?.agentSettings?.[this.id]?.mode,
    );
    // The read-only sandbox rejects --add-dir (additional WRITABLE roots), so
    // those flags are only valid when the sandbox can write at all.
    const readOnly = !options?.dangerouslySkipPermissions && mode === 'read-only';
    if (!readOnly) {
      cmd += buildAddDirFlags(options?.additionalDirs ?? []);
    }
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
      cmd += CODEX_MODE_FLAGS[mode];
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

/** Agents default to active; only an explicit `active: false` deactivates. */
export function isAgentActive(
  settings: WorkspaceAgentSettings | null | undefined,
  agentType: AgentTypeId,
): boolean {
  return settings?.[agentType]?.active !== false;
}

export function isAgentModeId(agentType: AgentTypeId, mode: string): boolean {
  return getAgentType(agentType).modes.some((m) => m.id === mode);
}

/** The workspace-configured mode for an agent, falling back to the agent's default. */
export function resolveAgentMode(
  settings: WorkspaceAgentSettings | null | undefined,
  agentType: AgentTypeId,
): string {
  const agent = getAgentType(agentType);
  return coerceModeId(agent.modes, agent.defaultModeId, settings?.[agentType]?.mode);
}

export const DEFAULT_PLAN_SKILL = '/engy:plan';
export const DEFAULT_IMPLEMENT_SKILL = '/engy:implement';

/**
 * Plan/implement skills for an agent: per-agent override first, then the
 * legacy workspace-level columns (pre-dating per-agent settings), then the
 * engy defaults.
 */
export function resolveAgentSkills(
  workspace: {
    planSkill?: string | null;
    implementSkill?: string | null;
    agentSettings?: WorkspaceAgentSettings | null;
  },
  agentType: AgentTypeId,
): { planSkill: string; implementSkill: string } {
  const entry = workspace.agentSettings?.[agentType];
  return {
    planSkill: entry?.planSkill || workspace.planSkill || DEFAULT_PLAN_SKILL,
    implementSkill: entry?.implementSkill || workspace.implementSkill || DEFAULT_IMPLEMENT_SKILL,
  };
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
  return `${window.location.origin}/mcp/${MCP_SESSION_PLACEHOLDER}`;
}

/**
 * Rewrites the first occurrence of `--session-id <token>` to `--resume <token>`.
 * Token may be bare or single-quoted; everything else is preserved verbatim.
 * Returns the command unchanged when the flag is absent.
 *
 * Used when respawning a lost PTY — rerunning `claude --session-id X` would
 * fail on a duplicate session id, `--resume X` continues the conversation instead.
 */
export function sessionIdFlagToResume(command: string): string {
  return command.replace(/--session-id ('(?:[^'\\]|\\.)*'|\S+)/, '--resume $1');
}
