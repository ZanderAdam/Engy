import { getStore } from './qmd-store';

export type QmdSearchMode = 'hybrid' | 'lex' | 'vector';

const QMD_CANDIDATE_CAP = 500;

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
 */
export async function runQmdSearch(
  workspaceSlug: string,
  query: string,
  collection: string | undefined,
  limit: number,
  mode: QmdSearchMode,
  intent: string | undefined,
): Promise<QmdSearchHit[]> {
  const store = await getStore(workspaceSlug);
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

  const hybrid = await store.search({ query, collection, limit: oversampledLimit, intent });
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
