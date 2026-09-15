export type DiffThreadSource = 'local' | 'github' | 'agent';

export type FindingSeverity = 'critical' | 'high' | 'medium';

const SEVERITIES: readonly FindingSeverity[] = ['critical', 'high', 'medium'];

/**
 * Who wrote a thread, read from metadata a reviewing agent also writes. Anything
 * unrecognised is the user's own comment: every thread predating the agent and
 * GitHub sources carries no `source` at all.
 */
export function threadSource(value: unknown): DiffThreadSource {
  if (value === 'github') return 'github';
  if (value === 'agent') return 'agent';
  return 'local';
}

/** Undefined for a thread carrying no severity, so the badge is simply absent. */
export function findingSeverity(value: unknown): FindingSeverity | undefined {
  return SEVERITIES.includes(value as FindingSeverity) ? (value as FindingSeverity) : undefined;
}

export function commentBodyText(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body ?? '');
}

export const SEVERITY_PRESENTATION: Record<
  FindingSeverity,
  { label: string; className: string }
> = {
  critical: { label: 'Critical', className: 'text-destructive' },
  high: { label: 'High', className: 'text-orange-400' },
  medium: { label: 'Medium', className: 'text-muted-foreground' },
};
