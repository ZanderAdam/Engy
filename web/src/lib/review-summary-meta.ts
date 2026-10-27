export type RiskLevel = 'low' | 'typical' | 'high' | 'very_high';

export type ReviewGuideSource = 'default' | 'project';

export interface ReviewRisk {
  level: RiskLevel;
  reason: string;
}

export const CHAPTER_ROLES = ['core', 'supporting', 'glue', 'tests'] as const;

export type ChapterRole = (typeof CHAPTER_ROLES)[number];

export interface ReadingChapter {
  title: string;
  files: string[];
  note: string;
  role?: ChapterRole;
  explanation?: string;
  systemContext?: string;
  risk?: ReviewRisk;
}

export const RISK_PRESENTATION: Record<
  RiskLevel,
  { label: string; shortLabel: string; className: string }
> = {
  low: { label: 'Low risk', shortLabel: 'Low', className: 'border-border text-muted-foreground' },
  typical: {
    label: 'Typical risk',
    shortLabel: 'Typical',
    className: 'border-border text-foreground/80',
  },
  high: {
    label: 'High risk',
    shortLabel: 'High',
    className: 'border-orange-400/60 text-orange-400',
  },
  very_high: {
    label: 'Very high risk',
    shortLabel: 'Very high',
    className: 'border-destructive/60 text-destructive',
  },
};

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && Object.hasOwn(RISK_PRESENTATION, value);
}

export function parseRisk(value: unknown): ReviewRisk | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { level, reason } = value as Record<string, unknown>;
  if (!isRiskLevel(level)) return undefined;
  return { level, reason: typeof reason === 'string' ? reason : '' };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseRole(value: unknown): ChapterRole | undefined {
  return CHAPTER_ROLES.find((role) => role === value);
}

function parseChapter(value: unknown): ReadingChapter | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  if (typeof fields.title !== 'string' || !Array.isArray(fields.files)) return undefined;
  const chapter: ReadingChapter = {
    title: fields.title,
    files: fields.files.filter((file): file is string => typeof file === 'string'),
    note: typeof fields.note === 'string' ? fields.note : '',
  };
  const role = parseRole(fields.role);
  const explanation = optionalText(fields.explanation);
  const systemContext = optionalText(fields.systemContext);
  const risk = parseRisk(fields.risk);
  if (role) chapter.role = role;
  if (explanation) chapter.explanation = explanation;
  if (systemContext) chapter.systemContext = systemContext;
  if (risk) chapter.risk = risk;
  return chapter;
}

export function parseReadingOrder(value: unknown): ReadingChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => parseChapter(item) ?? []);
}

export function parseOverview(value: unknown): string | undefined {
  return optionalText(value);
}

export function parseGuideSource(value: unknown): ReviewGuideSource | undefined {
  return value === 'default' || value === 'project' ? value : undefined;
}
