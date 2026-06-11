/**
 * Parse a task id from a string value (e.g. a URL search param).
 * Returns the numeric id when the value is a finite positive integer, null otherwise.
 */
export function parseTaskId(value: string | null): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}
