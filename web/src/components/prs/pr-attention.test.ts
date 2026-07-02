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

  it('should map attempt-cap to exhausted-attempts label', () => {
    const info = getAttentionInfo('attempt-cap');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('Auto-fix attempts exhausted');
    expect(info!.description).toContain('maximum number of attempts');
  });

  it('should return a fallback for unknown reasons', () => {
    const info = getAttentionInfo('some-unknown-reason');
    expect(info).not.toBeNull();
    expect(info!.label).toBe('CI failure needs attention');
    expect(info!.description).toBe('some-unknown-reason');
  });
});
