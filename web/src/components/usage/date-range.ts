export interface DateRange {
  from: string;
  to: string;
}

export type PresetId =
  | 'today'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'lastMonth'
  | 'allTime';

export const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'allTime', label: 'All time' },
];

export const DEFAULT_PRESET: PresetId = 'last30';

/** Claude Code did not exist before this; it is the open lower bound for "All time". */
const ALL_TIME_FROM = '2020-01-01';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-calendar ISO date. `toISOString()` would shift evening work onto the next day. */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function resolvePreset(id: PresetId, now: Date): DateRange {
  const today = toIsoDate(now);
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: toIsoDate(shiftDays(now, -6)), to: today };
    case 'last30':
      return { from: toIsoDate(shiftDays(now, -29)), to: today };
    case 'last90':
      return { from: toIsoDate(shiftDays(now, -89)), to: today };
    case 'thisMonth':
      return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toIsoDate(first), to: toIsoDate(last) };
    }
    case 'allTime':
      return { from: ALL_TIME_FROM, to: today };
  }
}

/** A preset serialises to resolved dates, so a shared link keeps its window tomorrow. */
export function matchPreset(range: DateRange, now: Date): PresetId | null {
  for (const preset of PRESETS) {
    const resolved = resolvePreset(preset.id, now);
    if (resolved.from === range.from && resolved.to === range.to) return preset.id;
  }
  return null;
}

export function parseRange(params: URLSearchParams, now: Date): DateRange {
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) {
    return { from, to };
  }
  return resolvePreset(DEFAULT_PRESET, now);
}

export function rangeLengthDays(range: DateRange): number {
  const from = Date.parse(`${range.from}T00:00:00`);
  const to = Date.parse(`${range.to}T00:00:00`);
  return Math.round((to - from) / 86_400_000) + 1;
}

export function describeRange(range: DateRange, now: Date): string {
  const preset = matchPreset(range, now);
  if (preset) return PRESETS.find((p) => p.id === preset)!.label;
  return `${range.from} → ${range.to}`;
}

export function previousWindowLabel(range: DateRange, now: Date): string {
  const preset = matchPreset(range, now);
  if (preset === 'today') return 'vs yesterday';
  if (preset === 'thisMonth' || preset === 'lastMonth') return 'vs previous month';
  if (preset === 'allTime') return 'vs previous window';
  return `vs previous ${rangeLengthDays(range)} days`;
}
