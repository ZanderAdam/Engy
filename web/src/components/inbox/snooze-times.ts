interface SnoozeOption {
  id: 'hour' | 'tomorrow' | 'monday';
  label: string;
  until: Date;
}

const HOUR_MS = 60 * 60 * 1000;
const MORNING_HOUR = 9;

function morningAfterDays(now: Date, days: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(MORNING_HOUR, 0, 0, 0);
  return date;
}

export function getSnoozeOptions(now: Date): SnoozeOption[] {
  const MONDAY = 1;
  const DAYS_PER_WEEK = 7;
  const daysUntilMonday = (DAYS_PER_WEEK + MONDAY - now.getDay()) % DAYS_PER_WEEK || DAYS_PER_WEEK;
  return [
    { id: 'hour', label: '1 hour', until: new Date(now.getTime() + HOUR_MS) },
    { id: 'tomorrow', label: 'Tomorrow, 09:00', until: morningAfterDays(now, 1) },
    { id: 'monday', label: 'Next Monday, 09:00', until: morningAfterDays(now, daysUntilMonday) },
  ];
}

export function parseCustomSnooze(value: string, now: Date): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() > now.getTime() ? date : null;
}
