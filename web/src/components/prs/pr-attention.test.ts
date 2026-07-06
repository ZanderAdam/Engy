import { describe, it, expect } from 'vitest';
import { getAttentionInfo } from './pr-attention';

describe('getAttentionInfo', () => {
  it('should return null for null reason', () => {
    expect(getAttentionInfo(null)).toBeNull();
  });

  it('should return null for undefined reason', () => {
    expect(getAttentionInfo(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(getAttentionInfo('')).toBeNull();
  });

  it('should map non-mechanical to manual attention label', () => {
    const info = getAttentionInfo('non-mechanical');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('CI failure needs manual attention');
    expect(info!.description).toContain("mechanically fixable");
  });

  it('should map uncorrelated to no-session label', () => {
    const info = getAttentionInfo('uncorrelated');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('No agent session for this branch');
    expect(info!.description).toContain('agent session');
  });

  it('should map attempt-cap-sha to per-commit exhausted label with new-commit hint', () => {
    const info = getAttentionInfo('attempt-cap-sha');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('Auto-fix attempts exhausted for this commit');
    expect(info!.description).toContain('new commit');
  });

  it('should map attempt-cap-total to permanently exhausted label', () => {
    const info = getAttentionInfo('attempt-cap-total');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('Auto-fix permanently exhausted');
    expect(info!.description).toContain('total attempt limit');
  });

  it('should map no-worktree to a worktree-resume label', () => {
    const info = getAttentionInfo('no-worktree');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('Agent session has no worktree to resume');
    expect(info!.description).toContain('worktree');
  });

  it('should return a fallback for unknown reasons', () => {
    const info = getAttentionInfo('some-unknown-reason');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('CI failure needs attention');
    expect(info!.description).toBe('some-unknown-reason');
  });
});
