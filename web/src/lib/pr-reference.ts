interface PrReference {
  repoFullName: string | null;
  prNumber: number;
}

const MAX_GRAPHQL_INT = 2_147_483_647;
const NUMBER_PATTERN = /^#?(\d+)$/;
const URL_PATTERN = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i;

function toReference(repoFullName: string | null, digits: string): PrReference | null {
  const prNumber = Number(digits);
  if (prNumber < 1 || prNumber > MAX_GRAPHQL_INT) return null;
  return { repoFullName, prNumber };
}

export function parsePrReference(text: string): PrReference | null {
  const trimmed = text.trim();
  const number = NUMBER_PATTERN.exec(trimmed);
  if (number) return toReference(null, number[1]);
  const url = URL_PATTERN.exec(trimmed);
  if (url) return toReference(url[1], url[2]);
  return null;
}
