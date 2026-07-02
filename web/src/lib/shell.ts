export function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export const ENGY_ORIENTATION = [
  'You are running inside Engy, a single-user AI-assisted engineering workspace.',
  'Workspaces hold ongoing work; projects are bounded scopes within them.',
  'The IDs below identify your current workspace and project; Engy MCP tools',
  '(mcp__Engy__*) take them to scope their operations.',
  '',
  'Engy MCP tools:',
  '- getWorkspaceDetails / getProjectDetails — filesystem paths (specs, docs) and execution context',
  '- listTaskGroups / listTasks / getTask — tasks and task groups',
  '- search — prior decisions, specs, and conventions',
  '- createTask / updateTask — track work items',
  '- createFleetingMemory — capture a durable learning for later promotion',
  '',
  'Before starting substantial work, consult prior decisions, conventions, and gotchas',
  'via the search tool — reuse what was already learned instead of rediscovering it.',
  '',
  'Before you finish substantial work, capture any durable, non-obvious learnings this',
  'session produced — a decision and its rationale, a gotcha found the hard way, a',
  'rejected approach — via createFleetingMemory (workspace id below). One claim per note;',
  'skip anything the diff or commits would already reveal.',
].join('\n');

export function buildAddDirFlags(dirs: string[]): string {
  if (dirs.length === 0) return '';
  return dirs.map((d) => ` --add-dir '${shellEscape(d)}'`).join('');
}

interface ContextBlockInput {
  workspace: { id: number; slug: string };
  project?: { id: number; slug: string; dir: string };
  repos: string[];
  autoAgentCompletion?: 'pr' | 'merge';
  earsBdd?: boolean;
  sessionId?: string;
}

export function buildContextBlock({
  workspace,
  project,
  repos,
  autoAgentCompletion,
  earsBdd,
  sessionId,
}: ContextBlockInput): string {
  const lines: string[] = [
    ENGY_ORIENTATION,
    '',
    `Workspace: ${workspace.slug} (id: ${workspace.id})`,
  ];
  if (project) {
    lines.push(`Project: ${project.slug} (id: ${project.id})`);
    lines.push(`Project dir: ${project.dir}`);
  }
  if (repos.length > 0) {
    const label = repos.length === 1 ? 'Repo' : 'Repos';
    lines.push(`${label}: ${repos.join(', ')}`);
  }
  if (autoAgentCompletion === 'pr') {
    lines.push(
      'When done, push your branch and create a pull request.',
    );
  } else if (autoAgentCompletion === 'merge') {
    lines.push(
      'When done, commit your changes. The system will handle merging automatically.',
    );
  }
  if (earsBdd) {
    lines.push(
      'EARS-BDD mode is enabled for this workspace — when implementing, follow the EARS → BDD requirements flow: establish/trace the functional requirements (FRs), write FR-tagged tests, and verify coverage.',
    );
  }
  if (sessionId) {
    lines.push(
      `Engy session id: ${sessionId} — pass this as sessionId to trace/validateWorkspace MCP tools so they scan your worktree, not the main checkout.`,
    );
  }
  return lines.join('\n');
}

export interface CiFixPromptInput {
  prNumber: number;
  prTitle: string;
  repo: string;
  headBranch: string;
  checks: Array<{ name: string; conclusion?: string | null }>;
  logs: Array<{ checkName: string; excerpt: string }>;
}

export function buildCiFixPrompt({
  prNumber,
  prTitle,
  repo,
  headBranch,
  checks,
  logs,
}: CiFixPromptInput): string {
  const parts: string[] = [
    `CI is failing on PR #${prNumber} "${prTitle}" (branch: ${headBranch}, repo: ${repo}).`,
    '',
    'Failing checks:',
  ];

  const failingChecks = checks.filter((c) => c.conclusion === 'failure');
  const checksToList = failingChecks.length > 0 ? failingChecks : checks;
  for (const check of checksToList) {
    parts.push(`  - ${check.name}`);
  }

  if (logs.length > 0) {
    parts.push('', 'Log excerpts:');
    for (const log of logs) {
      parts.push(`\n[${log.checkName}]`);
      parts.push(log.excerpt.trim());
    }
  }

  parts.push(
    '',
    'Fix the CI failures: resolve the errors shown above, run the relevant validation locally to confirm they pass, then commit and push to the same branch.',
  );

  return parts.join('\n');
}

export function buildClaudeCommand(options?: {
  prompt?: string;
  systemPrompt?: string;
  additionalDirs?: string[];
  dangerouslySkipPermissions?: boolean;
}): string {
  let cmd = 'claude';
  if (options?.prompt) {
    cmd += ` '${shellEscape(options.prompt)}'`;
  }
  cmd += buildAddDirFlags(options?.additionalDirs ?? []);
  if (options?.systemPrompt) {
    cmd += ` --append-system-prompt '${shellEscape(options.systemPrompt)}'`;
  }
  if (options?.dangerouslySkipPermissions) {
    cmd += ' --dangerously-skip-permissions';
  } else {
    cmd += ' --permission-mode acceptEdits';
  }
  return cmd;
}

// ── Quick-action directory logic — DO NOT CHANGE ──────────────────────
// When starting Claude from task quick actions (plan/implement):
//   - Working dir = 1st repo (so Claude runs inside the repo)
//   - Additional dirs = projectDir (if different) + remaining repos
// This is DIFFERENT from the default terminal which starts in projectDir.
// See use-terminal-scope.ts for the default terminal logic.
export function buildQuickActionDirs(
  repos: string[],
  projectDir?: string | null,
): { workingDir: string | undefined; additionalDirs: string[] } {
  const workingDir = repos[0] ?? projectDir ?? undefined;
  const additionalDirs = [
    ...(projectDir && projectDir !== workingDir ? [projectDir] : []),
    ...repos.slice(1),
  ];
  return { workingDir, additionalDirs };
}
