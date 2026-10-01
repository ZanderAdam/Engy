import { describe, it, expect } from 'vitest';
import { parseDisplayOptions } from './use-inbox-display-options';

describe('[FR-INBOX-440] parseDisplayOptions', () => {
  it('should default to unread first without snoozed items', () => {
    expect(parseDisplayOptions(null)).toEqual({ showSnoozed: false, unreadFirst: true });
  });

  it('should read stored values', () => {
    expect(parseDisplayOptions('{"showSnoozed":true,"unreadFirst":false}')).toEqual({
      showSnoozed: true,
      unreadFirst: false,
    });
  });

  it('should fall back per field for bad values', () => {
    expect(parseDisplayOptions('{"showSnoozed":"yes"}')).toEqual({
      showSnoozed: false,
      unreadFirst: true,
    });
  });

  it('should fall back to defaults for invalid JSON', () => {
    expect(parseDisplayOptions('{nope')).toEqual({ showSnoozed: false, unreadFirst: true });
  });
});
