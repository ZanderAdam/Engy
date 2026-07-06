import type { GhPrCheck } from '@engy/common';
import type { MaterialChange } from '../trpc/routers/pr';

export type CiFailureClassification = 'mechanical' | 'non-mechanical';

export interface FailedLog {
  checkName: string;
  excerpt: string;
}

// Conclusions that indicate a check has actually failed (mirrors FAILING_CONCLUSIONS in client gh layer).
const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'cancelled',
  'startup_failure',
]);

/**
 * Returns true for GhPrCheck entries that represent an actual failure.
 * CheckRun entries fail via conclusion; StatusContext entries (conclusion=null)
 * fail via their status field (FAILURE / ERROR).
 */
export function isFailingCheck(check: GhPrCheck): boolean {
  if (check.conclusion !== null) {
    return FAILING_CONCLUSIONS.has(check.conclusion.toLowerCase());
  }
  const state = check.status.toUpperCase();
  return state === 'FAILURE' || state === 'ERROR';
}

// Check names that indicate a mechanical (code-quality / tooling) failure.
const MECHANICAL_CHECK_PATTERNS = [
  'lint',
  'eslint',
  'typecheck',
  'type-check',
  'type check',
  'tsc',
  'typescript',
  'test',
  'vitest',
  'jest',
  'build',
  'knip',
  'format',
  'prettier',
  'deps',
  'install',
];

function isMechanicalCheckName(name: string): boolean {
  const lower = name.toLowerCase();
  return MECHANICAL_CHECK_PATTERNS.some((p) => lower.includes(p));
}

/**
 * From the upsert material changes, returns entries for PRs that newly
 * transitioned to ciStatus 'failing'.
 */
export function detectFailureTransitions(
  changes: MaterialChange[],
): Array<{ number: number; repo: string }> {
  return changes
    .filter((c) => c.type === 'ciStatus' && c.current === 'failing')
    .map((c) => ({ number: c.number, repo: c.repo }));
}

/**
 * Classifies a CI failure as mechanical (lint/type/test/build/deps tooling)
 * or non-mechanical (product logic, runtime, infrastructure), from check
 * names only — log excerpts are dispatch context, never classifier input.
 *
 * Conservative: unknown → 'non-mechanical'.
 */
export function classifyFailure(checks: GhPrCheck[]): CiFailureClassification {
  for (const check of checks) {
    if (isMechanicalCheckName(check.name)) return 'mechanical';
  }
  return 'non-mechanical';
}

