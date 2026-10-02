import { describe, it, expect } from 'vitest';
import { parseDisplayOptions } from './use-inbox-display-options';

describe('[FR-INBOX-440] parseDisplayOptions', () => {
  it('should default to activity order, unread first, without snoozed items', () => {
    expect(parseDisplayOptions(null)).toEqual({ showSnoozed: false, unreadFirst: true, sort: 'activity' });
  });

  it('should read stored values', () => {
    expect(
      parseDisplayOptions('{"showSnoozed":true,"unreadFirst":false,"sort":"number"}'),
    ).toEqual({
      showSnoozed: true,
      unreadFirst: false,
      sort: 'number',
    });
  });

  it('should fall back per field for bad values', () => {
    expect(parseDisplayOptions('{"showSnoozed":"yes","sort":"oldest"}')).toEqual({
      showSnoozed: false,
      unreadFirst: true,
      sort: 'activity',
    });
  });

  it('should fall back to defaults for invalid JSON', () => {
    expect(parseDisplayOptions('{nope')).toEqual({ showSnoozed: false, unreadFirst: true, sort: 'activity' });
  });
});
