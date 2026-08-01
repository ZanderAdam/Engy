import { extractSnippet, type QMDStore, type SearchResult } from '@tobilu/qmd';
import matter from 'gray-matter';
import { getStore } from './qmd-store';

export type QmdSearchMode = 'hybrid' | 'lex' | 'vector';

const QMD_CANDIDATE_CAP = 500;
const HYBRID_TIMEOUT_FALLBACK_MS = 30_000;
const SNIPPET_MAX_LEN = 200;

// qmd's buildFTS5Query joins every remaining token with AND, so a natural-language
// lex query like "how do we handle terminal reconnect" requires "how", "do", and
// "we" to appear literally in the doc — pruning function words first turns it into
// a query of just the meaningful terms.
const LEX_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'doing',
  'how',
  'what',
  'when',
  'where',
  'why',
  'which',
  'who',
  'whom',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'about',
  'into',
  'through',
  'from',
  'up',
  'down',
  'out',
  'off',
  'over',
  'under',
  'again',
  'then',
  'once',
  'here',
  'there',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'can',
  'will',
  'just',
  'should',
  'now',
  'and',
  'or',
  'but',
  'if',
  'because',
  'as',
  'until',
  'while',
]);

// Below this many tokens, relaxation stops — a 1-token query is already maximally broad.
const MIN_TOKENS_AFTER_RELAX = 2;
// Below this many tokens, there's nothing worth relaxing.
const MIN_TOKENS_TO_RELAX = 3;

function hybridTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.QMD_HYBRID_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : HYBRID_TIMEOUT_FALLBACK_MS;
}

/**
 * Rejects after `ms` with a lex/vector hint. qmd exposes no abort mechanism,
 * so the underlying search keeps running after a timeout — callers should
 * surface the error rather than retry aggressively.
 */
async function withHybridTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Hybrid search timed out after ${ms}ms — hybrid runs local LLM query expansion ` +
            `and reranking, which can take minutes on CPU-only hardware. ` +
            `Retry with mode: 'lex' (BM25) or mode: 'vector' (embeddings).`,
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface QmdSearchHit {
  file: string;
  displayPath: string;
  title: string;
  score: number;
  snippet?: string;
  bestChunk?: string;
}

export function isReadme(displayPath: string): boolean {
  const base = displayPath.split('/').pop() ?? '';
  return base.toLowerCase() === 'readme.md';
}

// ── Snippets ─────────────────────────────────────────────────────────

/**
 * Build a search-result snippet from a raw file body, guaranteeing frontmatter
 * never leaks in. qmd indexes (and returns) the raw file content including its
 * YAML frontmatter, so `extractSnippet` is run against the frontmatter-stripped
 * body instead; `chunkPos` (a string offset into the raw body, from vector/hybrid
 * results) is shifted back by the stripped length so it still lands in the
 * right place. Also drops extractSnippet's diff-style "@@ -line,count @@ (...)"
 * header — search results show a plain content preview, not a diff.
 */
function buildSnippet(
  rawBody: string | undefined,
  query: string,
  chunkPos: number | undefined,
): string | undefined {
  if (!rawBody) return undefined;

  let body = rawBody;
  let frontmatterLen = 0;
  try {
    const parsed = matter(rawBody);
    body = parsed.content;
    frontmatterLen = rawBody.length - body.length;
  } catch {
    // Malformed frontmatter — fall back to the raw body untouched.
  }

  const adjustedChunkPos =
    chunkPos !== undefined ? Math.max(0, chunkPos - frontmatterLen) : undefined;
  const { snippet } = extractSnippet(body, query, SNIPPET_MAX_LEN, adjustedChunkPos);

  const newlineIdx = snippet.indexOf('\n');
  return newlineIdx === -1 ? snippet : snippet.slice(newlineIdx + 1);
}

// ── Lex query relaxation ───────────────────────────────────────────────

/**
 * Split a query into tokens, keeping quoted phrases as single tokens so
 * relaxation never breaks apart a `"exact phrase"` the caller asked for.
 */
function tokenizeQuery(query: string): string[] {
  return query.match(/"[^"]*"|\S+/g) ?? [];
}

/**
 * Drop common English stop words from a lex query (quoted phrases and
 * negations, `-term`, are kept as-is since they're deliberate). No-op below
 * MIN_TOKENS_TO_RELAX tokens or if stripping would remove everything.
 */
function stripStopWords(query: string): string {
  const tokens = tokenizeQuery(query);
  if (tokens.length < MIN_TOKENS_TO_RELAX) return query;

  const kept = tokens.filter(
    (t) => t.startsWith('"') || t.startsWith('-') || !LEX_STOP_WORDS.has(t.toLowerCase()),
  );
  return kept.length > 0 ? kept.join(' ') : query;
}

/**
 * Progressively relax an over-restrictive AND-joined lex query by dropping its
 * shortest (least selective) remaining token one at a time, down to
 * MIN_TOKENS_AFTER_RELAX tokens. Quoted phrases and negations are never dropped.
 */
function* relaxedQueries(query: string): Generator<string> {
  const tokens = tokenizeQuery(query);
  if (tokens.length < MIN_TOKENS_TO_RELAX) return;

  const droppable = [...new Set(tokens)]
    .filter((t) => !t.startsWith('"') && !t.startsWith('-'))
    .sort((a, b) => a.length - b.length);

  let current = tokens;
  for (const term of droppable) {
    if (current.length <= MIN_TOKENS_AFTER_RELAX) break;
    current = current.filter((t) => t !== term);
    yield current.join(' ');
  }
}

/**
 * Run a lex search, stripping stop words first. If that still returns nothing
 * and the query has enough tokens left, progressively relax by dropping the
 * shortest remaining tokens until a search returns hits or relaxation is exhausted.
 */
async function searchLexWithRelaxation(
  store: QMDStore,
  query: string,
  collection: string | undefined,
  limit: number,
): Promise<SearchResult[]> {
  const stripped = stripStopWords(query);
  const results = await store.searchLex(stripped, { collection, limit });
  if (results.length > 0) return results;

  for (const relaxed of relaxedQueries(stripped)) {
    const retry = await store.searchLex(relaxed, { collection, limit });
    if (retry.length > 0) return retry;
  }
  return results;
}

/**
 * Run a qmd search in the chosen mode and normalise the result shape across
 * `hybridQuery`, `searchLex`, and `searchVector`. Returns a uniform `QmdSearchHit[]`
 * so callers don't have to branch on mode again downstream.
 *
 * README hits (auto-generated index files) are dropped in every mode; the store
 * is oversampled at 1.5× `limit` so the filter rarely underfills the requested limit.
 *
 * Both the tRPC router and the MCP `search` tool call this — keeps mode dispatch
 * in one place.
 *
 * Hybrid mode runs local LLM inference (query expansion + rerank) and is bounded
 * by QMD_HYBRID_TIMEOUT_MS (default 30s) so slow hardware fails fast with a hint
 * to use lex/vector instead of hanging the caller indefinitely.
 */
export async function runQmdSearch(
  workspace: { slug: string; docsDir: string | null },
  query: string,
  collection: string | undefined,
  limit: number,
  mode: QmdSearchMode,
  intent: string | undefined,
): Promise<QmdSearchHit[]> {
  const store = await getStore(workspace);
  const oversampledLimit = Math.min(Math.ceil(limit * 1.5), QMD_CANDIDATE_CAP);

  if (mode === 'lex' || mode === 'vector') {
    const results =
      mode === 'lex'
        ? await searchLexWithRelaxation(store, query, collection, oversampledLimit)
        : await store.searchVector(query, { collection, limit: oversampledLimit });
    return results
      .filter((r) => !isReadme(r.displayPath))
      .slice(0, limit)
      .map((r) => ({
        file: r.filepath,
        displayPath: r.displayPath,
        title: r.title,
        score: r.score,
        snippet: buildSnippet(r.body, query, r.chunkPos),
      }));
  }

  const hybrid = await withHybridTimeout(
    store.search({ query, collection, limit: oversampledLimit, intent }),
    hybridTimeoutMs(),
  );
  return hybrid
    .filter((r) => !isReadme(r.displayPath))
    .slice(0, limit)
    .map((r) => ({
      file: r.file,
      displayPath: r.displayPath,
      title: r.title,
      score: r.score,
      bestChunk: r.bestChunk,
      snippet: buildSnippet(r.body, query, r.bestChunkPos),
    }));
}
