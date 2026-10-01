import { describe, it, expect } from 'vitest';
import { getSnoozeOptions, parseCustomSnooze } from './snooze-times';

function optionUntil(now: Date, id: string): Date {
  const option = getSnoozeOptions(now).find((o) => o.id === id);
  if (!option) throw new Error(`missing option ${id}`);
  return option.until;
}

describe('[FR-INBOX-430] snooze-times', () => {
  describe('getSnoozeOptions', () => {
    const wednesday = new Date(2026, 8, 30, 14, 25, 10);

    it('should offer one hour from now', () => {
      expect(optionUntil(wednesday, 'hour').getTime() - wednesday.getTime()).toBe(3_600_000);
    });

    it('should offer tomorrow at 09:00 local time', () => {
      const until = optionUntil(wednesday, 'tomorrow');
      expect([until.getFullYear(), until.getMonth(), until.getDate()]).toEqual([2026, 9, 1]);
      expect([until.getHours(), until.getMinutes(), until.getSeconds()]).toEqual([9, 0, 0]);
    });

    it('should offer the next Monday at 09:00 local time', () => {
      const until = optionUntil(wednesday, 'monday');
      expect([until.getMonth(), until.getDate(), until.getDay()]).toEqual([9, 5, 1]);
      expect(until.getHours()).toBe(9);
    });

    it('should skip to the following week when today is Monday', () => {
      const monday = new Date(2026, 9, 5, 8, 0, 0);
      expect(optionUntil(monday, 'monday').getDate()).toBe(12);
    });

    it('should pick the next day when today is Sunday', () => {
      const sunday = new Date(2026, 9, 4, 20, 0, 0);
      expect(optionUntil(sunday, 'monday').getDate()).toBe(5);
    });
  });

  describe('parseCustomSnooze', () => {
    const now = new Date(2026, 8, 30, 12, 0, 0);

    it('should accept a future date-time', () => {
      expect(parseCustomSnooze('2026-10-02T09:30', now)?.getDate()).toBe(2);
    });

    it('should reject past, empty and invalid values', () => {
      expect(parseCustomSnooze('2026-09-29T09:30', now)).toBeNull();
      expect(parseCustomSnooze('', now)).toBeNull();
      expect(parseCustomSnooze('not a date', now)).toBeNull();
    });
  });
});
