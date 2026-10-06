export type CheckState = 'passing' | 'failing' | 'pending';

const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

export const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'cancelled',
  'startup_failure',
]);

export function deriveCheckState(status: string, conclusion: string | null): CheckState {
  const lowerConclusion = conclusion?.toLowerCase() ?? '';
  if (PASSING_CONCLUSIONS.has(lowerConclusion)) return 'passing';
  if (FAILING_CONCLUSIONS.has(lowerConclusion)) return 'failing';

  const lowerStatus = status.toLowerCase();
  if (lowerStatus === 'success' || lowerStatus === 'completed') return 'passing';
  if (lowerStatus === 'failure' || lowerStatus === 'error') return 'failing';
  return 'pending';
}
