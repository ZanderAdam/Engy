import { describe, it, expect } from 'vitest';
import { formatInboxBadge } from './inbox-button';

describe('[FR-INBOX-410] formatInboxBadge', () => {
  it('should hide the badge at zero', () => {
    expect(formatInboxBadge(0)).toBeNull();
  });

  it('should show the exact count up to 99', () => {
    expect(formatInboxBadge(1)).toBe('1');
    expect(formatInboxBadge(99)).toBe('99');
  });

  it('should cap larger counts at 99+', () => {
    expect(formatInboxBadge(100)).toBe('99+');
  });
});
