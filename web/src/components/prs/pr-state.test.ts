import { describe, it, expect } from 'vitest';
import { prStateVisual } from './pr-state';

const open = {
  isDraft: false,
  hasConflicts: false,
  ciStatus: 'pending' as const,
  reviewDecision: null as string | null,
};

describe('[FR-INBOX-580] prStateVisual', () => {
  it.each([
    ['Draft', { isDraft: true, hasConflicts: true, ciStatus: 'failing' as const }],
    ['Merge conflicts', { hasConflicts: true, ciStatus: 'failing' as const }],
    ['CI failing', { ciStatus: 'failing' as const, reviewDecision: 'APPROVED' }],
    ['Changes requested', { reviewDecision: 'CHANGES_REQUESTED' }],
    ['Ready to merge', { reviewDecision: 'APPROVED', ciStatus: 'passing' as const }],
    ['Approved', { reviewDecision: 'APPROVED' }],
    ['Waiting for review', {}],
  ])('should show %s first when it applies', (label, facts) => {
    expect(prStateVisual({ ...open, ...facts }).label).toBe(label);
  });

  it('should give each state its own icon and color', () => {
    const states = [
      { isDraft: true },
      { hasConflicts: true },
      { ciStatus: 'failing' as const },
      { reviewDecision: 'CHANGES_REQUESTED' },
      { reviewDecision: 'APPROVED', ciStatus: 'passing' as const },
      {},
    ].map((facts) => prStateVisual({ ...open, ...facts }));

    expect(new Set(states.map((state) => state.icon)).size).toBe(states.length);
    expect(new Set(states.map((state) => state.className)).size).toBe(states.length);
  });
});
