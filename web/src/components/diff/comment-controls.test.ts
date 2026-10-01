import { describe, expect, it } from 'vitest';
import { threadControls } from './comment-controls';

const base = { onReviewPage: true, canResolveLocally: true };

describe('threadControls', () => {
  it('[FR-PRMON-290] should give a draft thread no reply box and no resolve control', () => {
    const controls = threadControls({
      ...base,
      comment: { source: 'local', githubDraft: true, resolved: false },
    });
    expect(controls).toMatchObject({
      composer: false,
      githubResolveLabel: null,
      localResolveLabel: null,
      localOnlyBadge: false,
    });
  });

  it('[FR-PRMON-290] should let a GitHub thread reply and resolve on GitHub', () => {
    const controls = threadControls({
      ...base,
      comment: { source: 'github', githubDraft: false, resolved: false },
    });
    expect(controls).toMatchObject({
      composer: true,
      githubResolveLabel: 'Resolve',
      localResolveLabel: null,
      localOnlyBadge: false,
    });
  });

  it('[FR-PRMON-290] should offer Unresolve on a resolved GitHub thread', () => {
    const controls = threadControls({
      ...base,
      comment: { source: 'github', githubDraft: false, resolved: true },
    });
    expect(controls.githubResolveLabel).toBe('Unresolve');
  });

  it('[FR-PRMON-290] should mark a local thread local only and resolve it locally', () => {
    const controls = threadControls({
      ...base,
      comment: { source: 'local', githubDraft: false, resolved: false },
    });
    expect(controls).toMatchObject({
      composer: true,
      githubResolveLabel: null,
      localResolveLabel: 'Resolve',
      localOnlyBadge: true,
    });
  });

  it('should dismiss a GitHub thread locally outside the review page', () => {
    const controls = threadControls({
      onReviewPage: false,
      canResolveLocally: true,
      comment: { source: 'github', githubDraft: false, resolved: false },
    });
    expect(controls).toMatchObject({
      composer: false,
      githubResolveLabel: null,
      localResolveLabel: 'Dismiss',
    });
  });

  it('should hide the local-only badge outside the review page', () => {
    const controls = threadControls({
      onReviewPage: false,
      canResolveLocally: true,
      comment: { source: 'local', githubDraft: false, resolved: false },
    });
    expect(controls.localOnlyBadge).toBe(false);
    expect(controls.composer).toBe(true);
  });
});
