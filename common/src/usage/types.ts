export type UsageCostBucket = 'input' | 'output' | 'cacheWrite1h' | 'cacheWrite5m' | 'cacheRead';

export type UsageCauseKind = 'toolResult' | 'toolInput' | 'text' | 'image' | 'thinking';

export interface UsageTokenTotals {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  cacheWrite1hTokens: number;
  cacheWrite5mTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
}

/**
 * Attributed cost is reported as token-turns, not tokens: a block inserted at
 * call `c` of a `T`-call session is re-read `T - c` times, capped at the next
 * compaction boundary. Callers price these directly at the session's
 * cache-read rate — never scaled up to fill 100% of measured cache-read
 * spend, since attribution only ever covers a fraction of it (the rest is
 * the per-call baseline no content block carries: system prompt, tool defs,
 * CLAUDE.md, skills).
 */
export interface UsageAttribution {
  tokens: number;
  tokenTurns: number;
  calls: number;
}

export interface UsageToolRollup extends UsageAttribution {
  date: string;
  tool: string;
  resultChars: number;
  inputChars: number;
  images: number;
  errors: number;
  maxResultChars: number;
  p50ResultChars: number;
  p95ResultChars: number;
}

export interface UsageFieldRollup extends UsageAttribution {
  date: string;
  tool: string;
  field: string;
}

export interface UsageCauseRollup {
  date: string;
  kind: UsageCauseKind;
  tokenTurns: number;
}

export interface UsageFileRollup extends UsageAttribution {
  date: string;
  filePath: string;
  ext: string;
  reads: number;
  edits: number;
  writes: number;
  totalChars: number;
}

/**
 * One row per tool call, ranked by settled token-turns — the concrete
 * "single most expensive calls" view (payload size × later calls × rate).
 * `field` is the input field the preview was drawn from (`file_path` for
 * Read/Write/Edit, `command` for Bash, otherwise the largest input field),
 * or null when the call carried no input.
 */
export interface UsageExpensiveCall {
  date: string;
  sessionId: string;
  tool: string;
  field: string | null;
  tokens: number;
  tokenTurns: number;
  callIndex: number;
  preview: string;
}

export interface UsageDayRollup extends UsageTokenTotals {
  date: string;
  model: string;
  apiCalls: number;
}

export interface UsageSessionRollup extends UsageTokenTotals {
  sessionId: string;
  slug: string;
  cwd: string | null;
  gitBranch: string | null;
  model: string;
  startedAt: string | null;
  endedAt: string | null;
  apiCalls: number;
  agentCalls: number;
  /** Spawning session's id, for a subagent transcript under `.../subagents/agent-<id>.jsonl`. */
  parentSessionId: string | null;
  isSubagent: boolean;
  agentType: string | null;
  agentDescription: string | null;
}

export interface UsageCallPoint {
  callIndex: number;
  cacheReadTokens: number;
}

export interface UsageSessionScan {
  session: UsageSessionRollup;
  days: UsageDayRollup[];
  tools: UsageToolRollup[];
  fields: UsageFieldRollup[];
  files: UsageFileRollup[];
  causes: UsageCauseRollup[];
  /** Top 20 (by settled token-turns) tool calls in this session-scan pass. */
  expensiveCalls: UsageExpensiveCall[];
  /** Per-call cache-read size, in call order — drives the context-growth timeline. */
  calls: UsageCallPoint[];
  /** Auto-compaction events in this session — explains its cost shape (attribution caps at each boundary). */
  compactions: number;
  /** Byte offset consumed, for incremental rescans. */
  bytesScanned: number;
  linesParsed: number;
  linesSkipped: number;
}

export interface UsageModelRate {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheReadPerMTok: number;
}
