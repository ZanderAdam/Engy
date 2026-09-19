import { extname } from 'node:path';
import type {
  UsageCallPoint,
  UsageCauseKind,
  UsageCauseRollup,
  UsageDayRollup,
  UsageFieldRollup,
  UsageFileRollup,
  UsageSessionRollup,
  UsageSessionScan,
  UsageToolRollup,
} from '@engy/common';
import { estimateBlockTokens, estimateTextTokens, safeStringify } from './tokens.js';

/**
 * Cheap gate applied before JSON.parse. Roughly 78% of transcript lines carry
 * neither usage nor content blocks, and parsing them dominates a full scan.
 */
const USAGE_MARKER = '"cache_read_input_tokens"';
const CONTENT_MARKERS = ['"tool_use"', '"tool_result"', '"thinking"', '"text"'];

const MAX_CALL_POINTS = 200;

/**
 * Auto-compaction replaces the conversation prefix with a summary, so the
 * context collapses in one step. Detecting it matters because content added
 * before a compaction stops being re-read afterwards: charging it against the
 * rest of the session overstates early-session cost roughly 2.7x and invents a
 * "cost concentrates early" trend that measured per-decile spend does not show.
 */
const COMPACTION_DROP_RATIO = 0.6;
const COMPACTION_MIN_CONTEXT = 60_000;

const UNKNOWN_DATE = 'unknown';
const KEY_SEP = '\u0000';

export function lineMayMatter(line: string): boolean {
  if (line.includes(USAGE_MARKER)) return true;
  return CONTENT_MARKERS.some((marker) => line.includes(marker));
}

/**
 * Residual-cost accumulator. A block inserted after `c` API calls in a session
 * that makes `T` in total is re-read `T - c` times, so its token-turns are
 * `tokens * (T - c)`. Summed over a group that expands to
 * `T * sum(tokens) - sum(tokens * c)` — both running sums, so the whole scan
 * stays single-pass and its memory is bounded by the number of distinct groups
 * rather than the number of blocks.
 */
class ResidualSum {
  tokens = 0;
  private open = 0;
  private weighted = 0;
  private settled = 0;

  add(tokens: number, callsSoFar: number): void {
    this.tokens += tokens;
    this.open += tokens;
    this.weighted += tokens * callsSoFar;
  }

  /**
   * Close the current segment at `atCall`. Context surviving a compaction is
   * replaced by a summary, so blocks added before it stop being re-read there
   * and must not be charged against the rest of the session.
   */
  settle(atCall: number): void {
    this.settled += Math.max(0, atCall * this.open - this.weighted);
    this.open = 0;
    this.weighted = 0;
  }

  tokenTurns(totalCalls: number): number {
    return this.settled + Math.max(0, totalCalls * this.open - this.weighted);
  }
}

interface ToolAcc {
  date: string;
  tool: string;
  residual: ResidualSum;
  inputResidual: ResidualSum;
  calls: number;
  resultChars: number;
  inputChars: number;
  images: number;
  errors: number;
  maxResultChars: number;
}

interface FileAcc {
  date: string;
  filePath: string;
  residual: ResidualSum;
  reads: number;
  edits: number;
  writes: number;
  calls: number;
}

interface PendingToolUse {
  name: string;
  filePath: string | null;
}

const EMPTY_TOTALS = () => ({
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  cacheReadTokens: 0,
  cacheWrite1hTokens: 0,
  cacheWrite5mTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
  apiCalls: 0,
});

type Totals = ReturnType<typeof EMPTY_TOTALS>;

function addUsageTo(target: Totals, usage: Record<string, unknown>): void {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const cacheCreation = (usage.cache_creation ?? {}) as Record<string, unknown>;
  const outputDetails = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const serverTools = (usage.server_tool_use ?? {}) as Record<string, unknown>;

  target.apiCalls += 1;
  target.inputTokens += num(usage.input_tokens);
  target.outputTokens += num(usage.output_tokens);
  target.thinkingTokens += num(outputDetails.thinking_tokens);
  target.cacheReadTokens += num(usage.cache_read_input_tokens);
  target.cacheWrite1hTokens += num(cacheCreation.ephemeral_1h_input_tokens);
  target.cacheWrite5mTokens += num(cacheCreation.ephemeral_5m_input_tokens);
  target.webSearchRequests += num(serverTools.web_search_requests);
  target.webFetchRequests += num(serverTools.web_fetch_requests);
}

const FILE_PATH_KEYS = ['file_path', 'notebook_path'] as const;

function readFilePath(input: Record<string, unknown>): string | null {
  for (const key of FILE_PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

interface SessionReducerOptions {
  sessionId: string;
  slug: string;
  parentSessionId?: string | null;
  agentType?: string | null;
  agentDescription?: string | null;
}

export class SessionReducer {
  private readonly sessionId: string;
  private readonly slug: string;
  private readonly parentSessionId: string | null;
  private readonly agentType: string | null;
  private readonly agentDescription: string | null;

  private callsSoFar = 0;
  private linesParsed = 0;
  private linesSkipped = 0;
  private bytesScanned = 0;

  private cwd: string | null = null;
  private gitBranch: string | null = null;
  private startedAt: string | null = null;
  private endedAt: string | null = null;
  private agentCalls = 0;

  private readonly totals = EMPTY_TOTALS();
  private readonly modelCalls = new Map<string, number>();
  private readonly days = new Map<string, Totals & { date: string; model: string }>();
  private readonly tools = new Map<string, ToolAcc>();
  private readonly fields = new Map<
    string,
    { date: string; residual: ResidualSum; tool: string; field: string }
  >();
  private readonly files = new Map<string, FileAcc>();
  private readonly causes = new Map<string, { date: string; kind: UsageCauseKind; residual: ResidualSum }>();
  private readonly pending = new Map<string, PendingToolUse>();

  private callPoints: UsageCallPoint[] = [];
  private callStride = 1;

  private readonly residuals: ResidualSum[] = [];
  private previousContext = 0;
  private compactions = 0;
  private currentDate = UNKNOWN_DATE;

  constructor(options: SessionReducerOptions) {
    this.sessionId = options.sessionId;
    this.slug = options.slug;
    this.parentSessionId = options.parentSessionId ?? null;
    this.agentType = options.agentType ?? null;
    this.agentDescription = options.agentDescription ?? null;
  }

  addLine(line: string): void {
    this.bytesScanned += Buffer.byteLength(line) + 1;
    if (!lineMayMatter(line)) {
      this.linesSkipped += 1;
      return;
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.linesSkipped += 1;
      return;
    }
    this.linesParsed += 1;
    this.consume(entry);
  }

  private consume(entry: Record<string, unknown>): void {
    if (typeof entry.cwd === 'string') this.cwd = entry.cwd;
    if (typeof entry.gitBranch === 'string') this.gitBranch = entry.gitBranch;
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null;
    if (timestamp) {
      if (!this.startedAt) this.startedAt = timestamp;
      this.endedAt = timestamp;
      this.currentDate = timestamp.slice(0, 10);
    }

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== 'object') return;

    const usage = message.usage as Record<string, unknown> | undefined;
    const model = typeof message.model === 'string' ? message.model : 'unknown';

    if (usage && typeof usage === 'object') {
      this.callsSoFar += 1;
      addUsageTo(this.totals, usage);
      this.modelCalls.set(model, (this.modelCalls.get(model) ?? 0) + 1);

      const date = this.currentDate;
      const dayKey = `${date}${KEY_SEP}${model}`;
      let day = this.days.get(dayKey);
      if (!day) {
        day = { ...EMPTY_TOTALS(), date, model };
        this.days.set(dayKey, day);
      }
      addUsageTo(day, usage);
      this.recordCallPoint(usage);
      this.detectCompaction(usage);
    }

    const content = message.content;
    if (Array.isArray(content)) this.consumeBlocks(content);
  }

  private consumeBlocks(blocks: unknown[]): void {
    for (const raw of blocks) {
      if (!raw || typeof raw !== 'object') continue;
      const block = raw as Record<string, unknown>;
      switch (block.type) {
        case 'tool_use':
          this.consumeToolUse(block);
          break;
        case 'tool_result':
          this.consumeToolResult(block);
          break;
        case 'thinking':
          this.addCause('thinking', estimateTextTokens(asString(block.thinking)));
          break;
        case 'text':
          this.addCause('text', estimateTextTokens(asString(block.text)));
          break;
        default:
          break;
      }
    }
  }

  private consumeToolUse(block: Record<string, unknown>): void {
    const name = asString(block.name) || 'unknown';
    const input = (block.input ?? {}) as Record<string, unknown>;
    const id = asString(block.id);

    if (name === 'Agent') this.agentCalls += 1;
    if (id) this.pending.set(id, { name, filePath: readFilePath(input) });

    const serialisedInput = safeStringify(input);
    const tokens = estimateTextTokens(serialisedInput);
    this.addCause('toolInput', tokens);

    const tool = this.toolAcc(name);
    tool.inputResidual.add(tokens, this.callsSoFar);
    tool.inputChars += serialisedInput.length;

    for (const [key, value] of Object.entries(input)) {
      const fieldKey = `${this.currentDate}${KEY_SEP}${name}${KEY_SEP}${key}`;
      let field = this.fields.get(fieldKey);
      if (!field) {
        field = { date: this.currentDate, residual: this.newResidual(), tool: name, field: key };
        this.fields.set(fieldKey, field);
      }
      field.residual.add(estimateTextTokens(safeStringify(value)), this.callsSoFar);
    }
  }

  private consumeToolResult(block: Record<string, unknown>): void {
    const id = asString(block.tool_use_id);
    const origin = id ? this.pending.get(id) : undefined;
    if (id) this.pending.delete(id);

    const name = origin?.name ?? 'unknown';
    const { tokens, chars, isImage } = measureResult(block.content);

    this.addCause(isImage ? 'image' : 'toolResult', tokens);

    const tool = this.toolAcc(name);
    tool.residual.add(tokens, this.callsSoFar);
    tool.calls += 1;
    tool.resultChars += chars;
    tool.maxResultChars = Math.max(tool.maxResultChars, chars);
    if (isImage) tool.images += 1;
    if (block.is_error === true) tool.errors += 1;

    if (origin?.filePath) this.addFile(origin.filePath, name, tokens);
  }

  private addFile(filePath: string, tool: string, tokens: number): void {
    const key = `${this.currentDate}${KEY_SEP}${filePath}`;
    let file = this.files.get(key);
    if (!file) {
      file = {
        date: this.currentDate,
        filePath,
        residual: this.newResidual(),
        reads: 0,
        edits: 0,
        writes: 0,
        calls: 0,
      };
      this.files.set(key, file);
    }
    file.residual.add(tokens, this.callsSoFar);
    file.calls += 1;
    if (tool === 'Read') file.reads += 1;
    else if (tool === 'Write') file.writes += 1;
    else file.edits += 1;
  }

  private newResidual(): ResidualSum {
    const residual = new ResidualSum();
    this.residuals.push(residual);
    return residual;
  }

  private toolAcc(name: string): ToolAcc {
    const key = `${this.currentDate}${KEY_SEP}${name}`;
    let tool = this.tools.get(key);
    if (!tool) {
      tool = {
        date: this.currentDate,
        tool: name,
        residual: this.newResidual(),
        inputResidual: this.newResidual(),
        calls: 0,
        resultChars: 0,
        inputChars: 0,
        images: 0,
        errors: 0,
        maxResultChars: 0,
      };
      this.tools.set(key, tool);
    }
    return tool;
  }

  /**
   * The context-growth curve only needs its shape, but a session can run to
   * thousands of calls. Halving the kept points whenever the buffer fills keeps
   * both memory and the stored series bounded while preserving that shape.
   */
  private recordCallPoint(usage: Record<string, unknown>): void {
    if ((this.callsSoFar - 1) % this.callStride !== 0) return;

    const cacheRead = usage.cache_read_input_tokens;
    this.callPoints.push({
      callIndex: this.callsSoFar,
      cacheReadTokens: typeof cacheRead === 'number' && Number.isFinite(cacheRead) ? cacheRead : 0,
    });

    if (this.callPoints.length > MAX_CALL_POINTS) {
      this.callPoints = this.callPoints.filter((_, index) => index % 2 === 0);
      this.callStride *= 2;
    }
  }

  private detectCompaction(usage: Record<string, unknown>): void {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const context =
      num(usage.cache_read_input_tokens) +
      num(usage.cache_creation_input_tokens) +
      num(usage.input_tokens);

    const collapsed =
      this.previousContext > COMPACTION_MIN_CONTEXT &&
      context < COMPACTION_DROP_RATIO * this.previousContext;
    if (collapsed) {
      this.compactions += 1;
      for (const residual of this.residuals) residual.settle(this.callsSoFar);
    }
    this.previousContext = context;
  }

  private addCause(kind: UsageCauseKind, tokens: number): void {
    const key = `${this.currentDate}${KEY_SEP}${kind}`;
    let acc = this.causes.get(key);
    if (!acc) {
      acc = { date: this.currentDate, kind, residual: this.newResidual() };
      this.causes.set(key, acc);
    }
    acc.residual.add(tokens, this.callsSoFar);
  }

  private dominantModel(): string {
    let best = 'unknown';
    let bestCalls = -1;
    for (const [model, calls] of this.modelCalls) {
      if (calls > bestCalls) {
        best = model;
        bestCalls = calls;
      }
    }
    return best;
  }

  finish(): UsageSessionScan {
    const totalCalls = this.callsSoFar;
    const model = this.dominantModel();

    const session: UsageSessionRollup = {
      sessionId: this.sessionId,
      slug: this.slug,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      model,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      apiCalls: totalCalls,
      agentCalls: this.agentCalls,
      parentSessionId: this.parentSessionId,
      isSubagent: this.parentSessionId !== null,
      agentType: this.agentType,
      agentDescription: this.agentDescription,
      inputTokens: this.totals.inputTokens,
      outputTokens: this.totals.outputTokens,
      thinkingTokens: this.totals.thinkingTokens,
      cacheReadTokens: this.totals.cacheReadTokens,
      cacheWrite1hTokens: this.totals.cacheWrite1hTokens,
      cacheWrite5mTokens: this.totals.cacheWrite5mTokens,
      webSearchRequests: this.totals.webSearchRequests,
      webFetchRequests: this.totals.webFetchRequests,
    };

    const days: UsageDayRollup[] = [...this.days.values()].map((day) => ({
      date: day.date,
      model: day.model,
      apiCalls: day.apiCalls,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      thinkingTokens: day.thinkingTokens,
      cacheReadTokens: day.cacheReadTokens,
      cacheWrite1hTokens: day.cacheWrite1hTokens,
      cacheWrite5mTokens: day.cacheWrite5mTokens,
      webSearchRequests: day.webSearchRequests,
      webFetchRequests: day.webFetchRequests,
    }));

    const tools: UsageToolRollup[] = [...this.tools.values()].map((acc) => ({
      date: acc.date,
      tool: acc.tool,
      calls: acc.calls,
      tokens: acc.residual.tokens + acc.inputResidual.tokens,
      tokenTurns: acc.residual.tokenTurns(totalCalls) + acc.inputResidual.tokenTurns(totalCalls),
      resultChars: acc.resultChars,
      inputChars: acc.inputChars,
      images: acc.images,
      errors: acc.errors,
      maxResultChars: acc.maxResultChars,
    }));

    const fields: UsageFieldRollup[] = [...this.fields.values()].map((entry) => ({
      date: entry.date,
      tool: entry.tool,
      field: entry.field,
      tokens: entry.residual.tokens,
      tokenTurns: entry.residual.tokenTurns(totalCalls),
      calls: 0,
    }));

    const files: UsageFileRollup[] = [...this.files.values()].map((acc) => ({
      date: acc.date,
      filePath: acc.filePath,
      ext: extname(acc.filePath) || '<none>',
      reads: acc.reads,
      edits: acc.edits,
      writes: acc.writes,
      calls: acc.calls,
      tokens: acc.residual.tokens,
      tokenTurns: acc.residual.tokenTurns(totalCalls),
    }));

    const causes: UsageCauseRollup[] = [...this.causes.values()].map((entry) => ({
      date: entry.date,
      kind: entry.kind,
      tokenTurns: entry.residual.tokenTurns(totalCalls),
    }));

    return {
      session,
      days,
      tools,
      fields,
      files,
      causes,
      compactions: this.compactions,
      calls: this.callPoints,
      bytesScanned: this.bytesScanned,
      linesParsed: this.linesParsed,
      linesSkipped: this.linesSkipped,
    };
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function measureResult(content: unknown): { tokens: number; chars: number; isImage: boolean } {
  if (typeof content === 'string') {
    return { tokens: estimateTextTokens(content), chars: content.length, isImage: false };
  }
  if (Array.isArray(content)) {
    let tokens = 0;
    let chars = 0;
    let isImage = false;
    for (const block of content) {
      const estimate = estimateBlockTokens(block);
      tokens += estimate.tokens;
      isImage = isImage || estimate.isImage;
      chars += typeof block === 'string' ? block.length : safeStringify(block).length;
    }
    return { tokens, chars, isImage };
  }
  if (!content) return { tokens: 0, chars: 0, isImage: false };
  const serialised = safeStringify(content);
  return { tokens: estimateTextTokens(serialised), chars: serialised.length, isImage: false };
}
