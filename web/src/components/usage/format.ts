const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONEY_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

const TOKENS_COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const COUNT = new Intl.NumberFormat('en-US');

export function formatMoney(cents: number): string {
  return MONEY.format(cents / 100);
}

/** Tile and axis figures, where four significant digits beat exact cents. */
export function formatMoneyCompact(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 1000) return MONEY.format(dollars);
  return MONEY_COMPACT.format(dollars);
}

/** Per-call costs land in fractions of a cent, so they need more precision. */
export function formatMoneyPrecise(cents: number): string {
  const dollars = cents / 100;
  if (dollars !== 0 && Math.abs(dollars) < 0.01) return `$${dollars.toFixed(4)}`;
  return MONEY.format(dollars);
}

/** Axis ticks read better without cents. */
export function formatAxisMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 1000) return `$${Math.round(dollars)}`;
  return MONEY_COMPACT.format(dollars);
}

export function formatTokens(tokens: number): string {
  return TOKENS_COMPACT.format(tokens);
}

export function formatCount(value: number): string {
  return COUNT.format(value);
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

export interface Delta {
  fraction: number;
  direction: 'up' | 'down' | 'flat';
}

export function computeDelta(current: number, previous: number): Delta | null {
  if (previous === 0) return null;
  const fraction = (current - previous) / previous;
  if (Math.abs(fraction) < 0.001) return { fraction, direction: 'flat' };
  return { fraction, direction: fraction > 0 ? 'up' : 'down' };
}

export function formatDelta(delta: Delta): string {
  const sign = delta.fraction > 0 ? '+' : '';
  return `${sign}${(delta.fraction * 100).toFixed(1)}%`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
