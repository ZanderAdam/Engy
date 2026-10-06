export type GithubErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'validation'
  | 'network';

const SECRET_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /xox[a-z]-[A-Za-z0-9-]{10,}/g,
];

export function redactSecrets(text: string): string {
  let result = text;
  const token = process.env.ENGY_GITHUB_TOKEN;
  if (token) result = result.split(token).join('[redacted]');
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[redacted]');
  }
  return result;
}

export class GithubError extends Error {
  readonly kind: GithubErrorKind;
  readonly httpStatus: number | null;
  /** Epoch ms when a rate-limited request may be retried. */
  readonly resetAt: number | null;

  constructor(
    kind: GithubErrorKind,
    message: string,
    details: { httpStatus?: number; resetAt?: number } = {},
  ) {
    super(redactSecrets(message));
    this.name = 'GithubError';
    this.kind = kind;
    this.httpStatus = details.httpStatus ?? null;
    this.resetAt = details.resetAt ?? null;
  }
}
