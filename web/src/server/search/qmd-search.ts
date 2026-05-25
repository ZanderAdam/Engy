import { getStore } from './qmd-store';

export type QmdSearchMode = 'hybrid' | 'lex' | 'vector';

interface QmdSearchHit {
  file: string;
  displayPath: string;
  title: string;
  score: number;
  snippet?: string;
  bestChunk?: string;
}

/**
 * Run a qmd search in the chosen mode and normalise the result shape across
 * `hybridQuery`, `searchLex`, and `searchVector`. Returns a uniform `QmdSearchHit[]`
 * so callers don't have to branch on mode again downstream.
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

  if (mode === 'lex') {
    const lex = await store.searchLex(query, { collection, limit });
    return lex.map((r) => ({
      file: r.filepath,
      displayPath: r.displayPath,
      title: r.title,
      score: r.score,
      snippet: r.body ? r.body.slice(0, 200) : undefined,
    }));
  }

  if (mode === 'vector') {
    const vec = await store.searchVector(query, { collection, limit });
    return vec.map((r) => ({
      file: r.filepath,
      displayPath: r.displayPath,
      title: r.title,
      score: r.score,
      snippet: r.body ? r.body.slice(0, 200) : undefined,
    }));
  }

  const hybrid = await store.search({ query, collection, limit, intent });
  return hybrid.map((r) => ({
    file: r.file,
    displayPath: r.displayPath,
    title: r.title,
    score: r.score,
    bestChunk: r.bestChunk,
    snippet: r.bestChunk ? r.bestChunk.slice(0, 200) : undefined,
  }));
}
