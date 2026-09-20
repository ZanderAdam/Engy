/**
 * Row dates must match the local calendar day the work happened in — the seal
 * boundary (`localDateString` below) and the UI's range picker are both
 * local. Cutting the date from the UTC slice of the ISO timestamp instead
 * misdates lines near local midnight in any non-UTC zone, and in UTC+ zones
 * can seal a date that local lines are still being written into, dropping
 * them forever on the next scan.
 */
export function localDateFromTimestamp(timestamp: string): string {
  return localDateString(new Date(timestamp));
}

export function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
