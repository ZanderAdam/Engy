export function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export function buildAddDirFlags(dirs: string[]): string {
  if (dirs.length === 0) return '';
  return dirs.map((d) => ` --add-dir '${shellEscape(d)}'`).join('');
}

interface ContextBlockInput {
  workspace: { id: number; slug: string };
  project?: { id: number; slug: string; dir: string };
  repos: string[];
  autoAgentCompletion?: 'pr' | 'merge';
}

export function buildContextBlock({
  workspace,
  project,
  repos,
  autoAgentCompletion,
}: ContextBlockInput): string {
  const lines: string[] = [`Workspace: ${workspace.slug} (id: ${workspace.id})`];
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
  return lines.join('\n');
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
