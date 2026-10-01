interface ReviewUrlParams {
  repo: string | null;
  pr: number | null;
  project: string | null;
}

export function reviewUrlParams(search: URLSearchParams): ReviewUrlParams {
  const pr = Number(search.get('pr'));
  return {
    repo: search.get('repo') || null,
    pr: Number.isInteger(pr) && pr > 0 ? pr : null,
    project: search.get('project') || null,
  };
}
