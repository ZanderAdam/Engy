export type RiskLevel = 'low' | 'typical' | 'high' | 'very_high';

export type ReviewGuideSource = 'default' | 'project';

export interface ReviewRisk {
  level: RiskLevel;
  reason: string;
}

export interface ReadingChapter {
  title: string;
  files: string[];
  note: string;
}

export const RISK_PRESENTATION: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: 'Low risk', className: 'border-border text-muted-foreground' },
  typical: { label: 'Typical risk', className: 'border-border text-foreground/80' },
  high: { label: 'High risk', className: 'border-orange-400/60 text-orange-400' },
  very_high: { label: 'Very high risk', className: 'border-destructive/60 text-destructive' },
};

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && value in RISK_PRESENTATION;
}

export function parseRisk(value: unknown): ReviewRisk | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { level, reason } = value as Record<string, unknown>;
  if (!isRiskLevel(level)) return undefined;
  return { level, reason: typeof reason === 'string' ? reason : '' };
}

function parseChapter(value: unknown): ReadingChapter | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { title, files, note } = value as Record<string, unknown>;
  if (typeof title !== 'string' || !Array.isArray(files)) return undefined;
  return {
    title,
    files: files.filter((file): file is string => typeof file === 'string'),
    note: typeof note === 'string' ? note : '',
  };
}

export function parseReadingOrder(value: unknown): ReadingChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => parseChapter(item) ?? []);
}

export function parseGuideSource(value: unknown): ReviewGuideSource | undefined {
  return value === 'default' || value === 'project' ? value : undefined;
}
