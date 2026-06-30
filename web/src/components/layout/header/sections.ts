import {
  RiDashboardLine,
  RiFileTextLine,
  RiTaskLine,
  RiBrainLine,
  RiBrain2Line,
  RiGitPullRequestLine,
  RiCodeLine,
  RiGitMergeLine,
  RiTerminalBoxLine,
  type RemixiconComponentType,
} from '@remixicon/react';

interface SectionDef {
  label: string;
  segment: string;
  icon: RemixiconComponentType;
  disabled?: boolean;
  hint?: string;
}

/** The default section shown at a project's base path (the empty segment). */
export const overviewSection: SectionDef = { label: 'Overview', segment: '', icon: RiDashboardLine };

// Command Center is intentionally leftmost — a permanent, cross-project view of
// all active terminals. Overview remains the default section (empty segment).
export const sections: readonly SectionDef[] = [
  { label: 'Command Center', segment: 'command-center', icon: RiTerminalBoxLine },
  overviewSection,
  { label: 'Docs', segment: 'docs', icon: RiFileTextLine },
  { label: 'Tasks', segment: 'tasks', icon: RiTaskLine },
  { label: 'Claude Plans', segment: 'claude-plans', icon: RiBrainLine },
  { label: 'Diffs', segment: 'diffs', icon: RiGitMergeLine },
  { label: 'Code', segment: 'code', icon: RiCodeLine },
  { label: 'Memory', segment: 'memory', icon: RiBrain2Line },
  { label: 'PRs', segment: 'prs', icon: RiGitPullRequestLine, disabled: true, hint: 'Coming soon' },
] as const;

export function activeSection(pathname: string, basePath: string): SectionDef | undefined {
  if (pathname === basePath) return overviewSection;
  return sections.find((s) => s.segment && pathname.startsWith(`${basePath}/${s.segment}`));
}
