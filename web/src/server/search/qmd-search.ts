import { getStore } from './qmd-store';

export type QmdSearchMode = 'hybrid' | 'lex' | 'vector';

const QMD_CANDIDATE_CAP = 500;
const HYBRID_TIMEOUT_FALLBACK_MS = 30_000;

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
        ? await store.searchLex(query, { collection, limit: oversampledLimit })
        : await store.searchVector(query, { collection, limit: oversampledLimit });
    return results
      .filter((r) => !isReadme(r.displayPath))
      .slice(0, limit)
      .map((r) => ({
        file: r.filepath,
        displayPath: r.displayPath,
        title: r.title,
        score: r.score,
        snippet: r.body ? r.body.slice(0, 200) : undefined,
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
      snippet: r.bestChunk ? r.bestChunk.slice(0, 200) : undefined,
    }));
}
