import type { InboxEventKind } from '../inbox/bucket';
import type { AppState } from '../trpc/context';
import { githubGraphql } from './client';

const TIMELINE_QUERY = `
query PrTimeline($owner: String!, $name: String!, $number: Int!, $since: DateTime) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title
      url
      state
      reviewDecision
      author { login }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } }
      }
      timelineItems(
        since: $since
        last: 50
        itemTypes: [
          ISSUE_COMMENT
          PULL_REQUEST_REVIEW
          REVIEW_REQUESTED_EVENT
          MERGED_EVENT
          CLOSED_EVENT
          REOPENED_EVENT
          PULL_REQUEST_COMMIT
          HEAD_REF_FORCE_PUSHED_EVENT
          ASSIGNED_EVENT
        ]
      ) {
        nodes {
          __typename
          ... on IssueComment { id createdAt body url author { login } }
          ... on PullRequestReview {
            id submittedAt state body url author { login }
            comments(first: 1) { nodes { path line } }
          }
          ... on ReviewRequestedEvent {
            id createdAt actor { login }
            requestedReviewer { __typename ... on User { login } ... on Team { slug } }
          }
          ... on MergedEvent { id createdAt actor { login } url }
          ... on ClosedEvent { id createdAt actor { login } url }
          ... on ReopenedEvent { id createdAt actor { login } }
          ... on PullRequestCommit {
            id url
            commit { committedDate author { user { login } } }
          }
          ... on HeadRefForcePushedEvent { id createdAt actor { login } }
          ... on AssignedEvent { id createdAt actor { login } assignee { __typename ... on User { login } } }
        }
      }
    }
  }
}`;

interface Login {
  login: string;
}

interface Reviewer {
  __typename?: string;
  login?: string;
  slug?: string;
}

export interface TimelineNode {
  __typename: string;
  id?: string;
  createdAt?: string;
  submittedAt?: string | null;
  body?: string;
  url?: string;
  state?: string;
  author?: Login | null;
  actor?: Login | null;
  comments?: { nodes: Array<{ path: string; line: number | null }> };
  requestedReviewer?: Reviewer | null;
  assignee?: Reviewer | null;
  commit?: { committedDate: string; author: { user: Login | null } | null };
}

interface RawPullRequest {
  title: string;
  url: string;
  state: string;
  reviewDecision: string | null;
  author: Login | null;
  reviewRequests: { nodes: Array<{ requestedReviewer: Reviewer | null }> };
  timelineItems: { nodes: Array<TimelineNode | null> };
}

export interface TimelineEvent {
  kind: InboxEventKind;
  actor: string | null;
  summary: string;
  url: string | null;
  at: string;
  sourceKey: string;
}

export interface PrTimeline {
  title: string;
  url: string;
  state: string;
  reviewDecision: string | null;
  authorLogin: string | null;
  viewerReviewRequested: boolean;
  events: TimelineEvent[];
}

interface FetchTimelineInput {
  owner: string;
  name: string;
  number: number;
  since: string | null;
  viewerLogin: string;
  viewerTeamRequested?: boolean;
}

export function sameLogin(a: string | null | undefined, b: string): boolean {
  return a !== null && a !== undefined && a.toLowerCase() === b.toLowerCase();
}

export function mentionsViewer(body: string | undefined, viewerLogin: string): boolean {
  if (!body) return false;
  const escaped = viewerLogin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])@${escaped}(?![\\w-])`, 'i').test(body);
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function commentLocation(node: TimelineNode): string {
  const first = node.comments?.nodes[0];
  if (!first) return '';
  return first.line === null ? ` on ${first.path}` : ` on ${first.path}:${first.line}`;
}

function mapComment(node: TimelineNode, actor: string, viewerLogin: string): TimelineEvent | null {
  if (!node.id || !node.createdAt) return null;
  const mentioned = mentionsViewer(node.body, viewerLogin);
  return {
    kind: mentioned ? 'mentioned' : 'commented',
    actor,
    summary: mentioned ? `${actor} mentioned you` : `${actor} commented`,
    url: node.url ?? null,
    at: node.createdAt,
    sourceKey: `gh:${node.id}`,
  };
}

function mapReview(node: TimelineNode, actor: string, viewerLogin: string): TimelineEvent | null {
  const at = node.submittedAt;
  if (!node.id || !at) return null;
  const base = { actor, url: node.url ?? null, at, sourceKey: `gh:${node.id}` };
  if (mentionsViewer(node.body, viewerLogin)) {
    return { ...base, kind: 'mentioned', summary: `${actor} mentioned you` };
  }
  switch (node.state) {
    case 'APPROVED':
      return { ...base, kind: 'approved', summary: `${actor} approved` };
    case 'CHANGES_REQUESTED':
      return { ...base, kind: 'changes_requested', summary: `${actor} requested changes` };
    case 'COMMENTED': {
      const location = commentLocation(node);
      if (!location) return { ...base, kind: 'reviewed', summary: `${actor} reviewed` };
      return { ...base, kind: 'commented', summary: `${actor} commented${location}` };
    }
    case 'DISMISSED':
      return { ...base, kind: 'reviewed', summary: `${actor}'s review was dismissed` };
    default:
      return null;
  }
}

function isViewerRequested(
  reviewer: Reviewer | null | undefined,
  viewerLogin: string,
  viewerTeamRequested: boolean,
): boolean {
  if (reviewer?.__typename === 'Team') return viewerTeamRequested;
  return sameLogin(reviewer?.login, viewerLogin);
}

function mapReviewRequest(
  node: TimelineNode,
  actor: string,
  viewerLogin: string,
  viewerTeamRequested: boolean,
): TimelineEvent | null {
  if (!node.id || !node.createdAt) return null;
  if (!isViewerRequested(node.requestedReviewer, viewerLogin, viewerTeamRequested)) return null;
  const isTeam = node.requestedReviewer?.__typename === 'Team';
  return {
    kind: 'review_requested',
    actor,
    summary: `${actor} requested ${isTeam ? "your team's" : 'your'} review`,
    url: null,
    at: node.createdAt,
    sourceKey: `gh:${node.id}`,
  };
}

function mapAssignment(
  node: TimelineNode,
  actor: string,
  viewerLogin: string,
): TimelineEvent | null {
  if (!node.id || !node.createdAt || !sameLogin(node.assignee?.login, viewerLogin)) return null;
  return {
    kind: 'assigned',
    actor,
    summary: `${actor} assigned you`,
    url: null,
    at: node.createdAt,
    sourceKey: `gh:${node.id}`,
  };
}

function mapStateChange(
  node: TimelineNode,
  actor: string | null,
  kind: 'merged' | 'closed' | 'reopened',
): TimelineEvent | null {
  if (!node.id || !node.createdAt) return null;
  return {
    kind,
    actor,
    summary: `PR ${kind}`,
    url: node.url ?? null,
    at: node.createdAt,
    sourceKey: `gh:${node.id}`,
  };
}

function mapForcePush(node: TimelineNode, actor: string): TimelineEvent | null {
  if (!node.id || !node.createdAt) return null;
  return {
    kind: 'pushed',
    actor,
    summary: `${actor} force-pushed`,
    url: null,
    at: node.createdAt,
    sourceKey: `gh:${node.id}`,
  };
}

function mapCommitPushes(nodes: TimelineNode[], viewerLogin: string): TimelineEvent[] {
  const byAuthor = new Map<string, TimelineNode[]>();
  for (const node of nodes) {
    const author = node.commit?.author?.user?.login;
    if (!node.id || !author || sameLogin(author, viewerLogin)) continue;
    byAuthor.set(author, [...(byAuthor.get(author) ?? []), node]);
  }

  const events: TimelineEvent[] = [];
  for (const [author, commits] of byAuthor) {
    const latest = commits[commits.length - 1];
    events.push({
      kind: 'pushed',
      actor: author,
      summary: `${author} pushed ${pluralize(commits.length, 'commit')}`,
      url: latest.url ?? null,
      at: latest.commit?.committedDate ?? '',
      sourceKey: `gh:${latest.id}`,
    });
  }
  return events.filter((event) => event.at !== '');
}

function mapNode(
  node: TimelineNode,
  viewerLogin: string,
  viewerTeamRequested: boolean,
): TimelineEvent | null {
  const actor = node.author?.login ?? node.actor?.login ?? null;
  if (actor !== null && sameLogin(actor, viewerLogin)) return null;
  const name = actor ?? 'Someone';

  switch (node.__typename) {
    case 'IssueComment':
      return mapComment(node, name, viewerLogin);
    case 'PullRequestReview':
      return mapReview(node, name, viewerLogin);
    case 'ReviewRequestedEvent':
      return mapReviewRequest(node, name, viewerLogin, viewerTeamRequested);
    case 'AssignedEvent':
      return mapAssignment(node, name, viewerLogin);
    case 'MergedEvent':
      return mapStateChange(node, actor, 'merged');
    case 'ClosedEvent':
      return mapStateChange(node, actor, 'closed');
    case 'ReopenedEvent':
      return mapStateChange(node, actor, 'reopened');
    case 'HeadRefForcePushedEvent':
      return mapForcePush(node, name);
    default:
      return null;
  }
}

export function mapTimelineNodes(
  nodes: Array<TimelineNode | null>,
  viewerLogin: string,
  viewerTeamRequested = false,
): TimelineEvent[] {
  const present = nodes.filter((node): node is TimelineNode => node !== null);
  const commits = present.filter((node) => node.__typename === 'PullRequestCommit');
  const events = present
    .filter((node) => node.__typename !== 'PullRequestCommit')
    .map((node) => mapNode(node, viewerLogin, viewerTeamRequested))
    .filter((event): event is TimelineEvent => event !== null);
  return [...events, ...mapCommitPushes(commits, viewerLogin)].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}

export async function fetchPrTimeline(
  state: AppState,
  input: FetchTimelineInput,
): Promise<PrTimeline | null> {
  const data = await githubGraphql<{ repository: { pullRequest: RawPullRequest | null } | null }>(
    state,
    TIMELINE_QUERY,
    { owner: input.owner, name: input.name, number: input.number, since: input.since },
  );
  const pr = data.repository?.pullRequest;
  if (!pr) return null;
  const viewerTeamRequested = input.viewerTeamRequested ?? false;

  return {
    title: pr.title,
    url: pr.url,
    state: pr.state,
    reviewDecision: pr.reviewDecision,
    authorLogin: pr.author?.login ?? null,
    viewerReviewRequested: pr.reviewRequests.nodes.some((node) =>
      isViewerRequested(node.requestedReviewer, input.viewerLogin, viewerTeamRequested),
    ),
    events: mapTimelineNodes(pr.timelineItems.nodes, input.viewerLogin, viewerTeamRequested),
  };
}
