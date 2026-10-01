import type { GhPrCheck, GhPrCiStatus } from '@engy/common';
import type { AppState } from '../trpc/context';
import { githubGraphql } from './client';
import { GithubError } from './errors';
import {
  deriveCiStatus,
  normalizeCheck,
  reviewerName,
  type RawReviewer,
  type RawStatusCheckEntry,
} from './prs';

interface PrActor {
  login: string;
  avatarUrl: string | null;
}

interface PrPerson extends PrActor {
  isTeam: boolean;
}

export type ConversationItem =
  | {
      kind: 'comment';
      id: string;
      author: PrActor | null;
      body: string;
      createdAt: string;
      url: string;
    }
  | {
      kind: 'review';
      id: string;
      author: PrActor | null;
      state: string;
      body: string;
      createdAt: string;
      url: string;
    }
  | {
      kind: 'commit';
      id: string;
      oid: string;
      headline: string;
      author: PrActor | null;
      createdAt: string;
      url: string;
    };

export interface PrDetail {
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  createdAt: string;
  author: PrActor | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  mergeable: string;
  reviewRequests: PrPerson[];
  assignees: PrActor[];
  labels: Array<{ name: string; color: string }>;
  ciStatus: GhPrCiStatus;
  checks: GhPrCheck[];
  conversation: ConversationItem[];
}

interface RawActor {
  login: string;
  avatarUrl?: string | null;
}

interface RawComment {
  id: string;
  author: RawActor | null;
  body: string;
  createdAt: string;
  url: string;
}

interface RawReview {
  id: string;
  author: RawActor | null;
  state: string;
  body: string;
  submittedAt: string | null;
  createdAt: string;
  url: string;
}

interface RawCommit {
  commit: {
    oid: string;
    messageHeadline: string;
    committedDate: string;
    url: string;
    author: { name: string | null; user: RawActor | null } | null;
  };
}

interface RawDetail {
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  createdAt: string;
  author: RawActor | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  mergeable: string;
  reviewRequests: {
    nodes: Array<{ requestedReviewer: (RawReviewer & { avatarUrl?: string }) | null }>;
  };
  assignees: { nodes: RawActor[] };
  labels: { nodes: Array<{ name: string; color: string }> };
  comments: { nodes: RawComment[] };
  reviews: { nodes: RawReview[] };
  commits: { nodes: RawCommit[] };
  lastCommit: {
    nodes: Array<{
      commit: { statusCheckRollup: { contexts: { nodes: RawStatusCheckEntry[] } } | null };
    }>;
  };
}

interface DetailResponse {
  repository: { pullRequest: RawDetail | null } | null;
}

export const CONVERSATION_LIMIT = 100;
const SHORT_OID_LENGTH = 7;

const DETAIL_QUERY = `
query PrDetail($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title
      body
      state
      isDraft
      url
      createdAt
      author { login avatarUrl }
      baseRefName
      headRefName
      headRefOid
      additions
      deletions
      changedFiles
      reviewDecision
      mergeable
      reviewRequests(first: 20) {
        nodes {
          requestedReviewer {
            __typename
            ... on User { login avatarUrl }
            ... on Team { slug avatarUrl organization { login } }
          }
        }
      }
      assignees(first: 10) { nodes { login avatarUrl } }
      labels(first: 20) { nodes { name color } }
      comments(last: $limit) {
        nodes { id author { login avatarUrl } body createdAt url }
      }
      reviews(last: $limit) {
        nodes { id author { login avatarUrl } state body submittedAt createdAt url }
      }
      commits(last: $limit) {
        nodes {
          commit {
            oid
            messageHeadline
            committedDate
            url
            author { name user { login avatarUrl } }
          }
        }
      }
      lastCommit: commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

function toActor(raw: RawActor | null): PrActor | null {
  if (!raw) return null;
  return { login: raw.login, avatarUrl: raw.avatarUrl ?? null };
}

function toCommitAuthor(author: RawCommit['commit']['author']): PrActor | null {
  if (author?.user) return toActor(author.user);
  if (author?.name) return { login: author.name, avatarUrl: null };
  return null;
}

export function buildConversation(raw: {
  comments: RawComment[];
  reviews: RawReview[];
  commits: RawCommit[];
}): ConversationItem[] {
  const items: ConversationItem[] = [
    ...raw.comments.map(
      (c): ConversationItem => ({
        kind: 'comment',
        id: c.id,
        author: toActor(c.author),
        body: c.body,
        createdAt: c.createdAt,
        url: c.url,
      }),
    ),
    ...raw.reviews
      .filter((r) => r.state !== 'PENDING')
      .map(
        (r): ConversationItem => ({
          kind: 'review',
          id: r.id,
          author: toActor(r.author),
          state: r.state,
          body: r.body,
          createdAt: r.submittedAt ?? r.createdAt,
          url: r.url,
        }),
      ),
    ...raw.commits.map(
      ({ commit }): ConversationItem => ({
        kind: 'commit',
        id: commit.oid,
        oid: commit.oid.slice(0, SHORT_OID_LENGTH),
        headline: commit.messageHeadline,
        author: toCommitAuthor(commit.author),
        createdAt: commit.committedDate,
        url: commit.url,
      }),
    ),
  ];
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return items.slice(-CONVERSATION_LIMIT);
}

function toPerson(raw: RawDetail['reviewRequests']['nodes'][number]): PrPerson | null {
  const name = reviewerName(raw.requestedReviewer);
  if (!name) return null;
  return {
    login: name,
    avatarUrl: raw.requestedReviewer?.avatarUrl ?? null,
    isTeam: raw.requestedReviewer?.__typename === 'Team',
  };
}

function toDetail(raw: RawDetail): PrDetail {
  const rollup = raw.lastCommit.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? null;
  return {
    title: raw.title,
    body: raw.body,
    state: raw.state,
    isDraft: raw.isDraft,
    url: raw.url,
    createdAt: raw.createdAt,
    author: toActor(raw.author),
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    reviewDecision: raw.reviewDecision ?? null,
    mergeable: raw.mergeable,
    reviewRequests: raw.reviewRequests.nodes
      .map(toPerson)
      .filter((person): person is PrPerson => person !== null),
    assignees: raw.assignees.nodes.map((a) => ({ login: a.login, avatarUrl: a.avatarUrl ?? null })),
    labels: raw.labels.nodes,
    ciStatus: deriveCiStatus(rollup),
    checks: (rollup ?? []).map(normalizeCheck),
    conversation: buildConversation({
      comments: raw.comments.nodes,
      reviews: raw.reviews.nodes,
      commits: raw.commits.nodes,
    }),
  };
}

export async function fetchPrDetail(
  state: AppState,
  repoFullName: string,
  prNumber: number,
): Promise<PrDetail> {
  const [owner, name] = repoFullName.split('/');
  const data = await githubGraphql<DetailResponse>(state, DETAIL_QUERY, {
    owner,
    name,
    number: prNumber,
    limit: CONVERSATION_LIMIT,
  });
  const raw = data.repository?.pullRequest;
  if (!raw) throw new GithubError('not_found', `${repoFullName}#${prNumber} was not found`);
  return toDetail(raw);
}
