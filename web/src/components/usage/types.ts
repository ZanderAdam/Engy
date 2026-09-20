/**
 * Mirrors the `usage` tRPC router's output shape. Components take these as
 * plain props so the whole screen tree stays renderable and testable without
 * the router. Money is always integer cents.
 */

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  cacheWrite1hTokens: number;
  cacheWrite5mTokens: number;
  apiCalls: number;
  sessions: number;
}

export interface UsageCost {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
  subagentCost: number;
}

export interface UsageSeriesPoint {
  date: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface UsageGroup {
  key: string;
  label: string;
  cost: number;
  cacheReadTokens: number;
  sessions: number;
}

export interface UsageCauses {
  baseline: number;
  toolResult: number;
  toolInput: number;
  text: number;
  image: number;
  thinking: number;
}

export interface UsageCacheEfficiency {
  readsPerWrite: number;
  breakEven: number;
}

export interface UsageOverview {
  subagentShare: number;
  totals: UsageTotals;
  cost: UsageCost;
  previous: {
    total: number;
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
  series: UsageSeriesPoint[];
  groups: UsageGroup[];
  causes: UsageCauses;
  cacheEfficiency: UsageCacheEfficiency;
  unpricedModels: string[];
}

export interface UsageToolRow {
  tool: string;
  calls: number;
  costCents: number;
  costPerCallCents: number;
  resultTokens: number;
  maxResultChars: number;
  images: number;
  errors: number;
}

export interface UsageFieldRow {
  tool: string;
  field: string;
  costCents: number;
  tokens: number;
}

export interface UsageFileRow {
  key: string;
  reads: number;
  edits: number;
  writes: number;
  tokens: number;
  costCents: number;
}

export interface UsageSessionRow {
  sessionId: string;
  slug: string;
  repoRoot: string | null;
  label: string;
  model: string;
  startedAt: string | null;
  apiCalls: number;
  costCents: number;
  subagentCostCents: number;
  subagentCalls: number;
  readsPerWrite: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  durationMinutes?: number | null;
}

export interface UsageExpensiveCallRow {
  date: string;
  sessionId: string;
  callIndex: number;
  tool: string;
  field: string | null;
  tokens: number;
  tokenTurns: number;
  costCents: number;
  preview: string;
}

export interface UsageSubagentRow {
  sessionId: string;
  agentType: string | null;
  agentDescription: string | null;
  model: string;
  apiCalls: number;
  costCents: number;
}

export interface UsageCallSeriesPoint {
  callIndex: number;
  cacheReadTokens: number;
}

export interface UsageSessionDetail {
  session: UsageSessionRow;
  tools: UsageToolRow[];
  files: UsageFileRow[];
  fields: UsageFieldRow[];
  subagents: UsageSubagentRow[];
  callSeries: UsageCallSeriesPoint[];
}

export type FileGroupBy = 'path' | 'ext' | 'dir';
export type GroupAxis = 'repo' | 'slug';
export type UsageView = 'overview' | 'burn' | 'sessions';

export type UsageScope = 'all' | 'workspace' | 'project';
