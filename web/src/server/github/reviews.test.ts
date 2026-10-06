import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { diffDocPath } from '@/lib/diff-doc-path';
import { draftsToReviewComments, fetchPullHeadSha, submitReview } from './reviews';
import { startStubGithub, type StubGithub } from './stub-server';

const docPath = (file: string) => diffDocPath('/repos/app', 'feat/seven', file);

const thread = (
  file: string,
  metadata: Record<string, unknown>,
  body: unknown = 'text',
  deletedAt: string | null = null,
) => ({
  documentPath: docPath(file),
  metadata,
  comments: [{ body, deletedAt }],
});

describe('github reviews', () => {
  let stub: StubGithub;
  let state: AppState;

  beforeEach(async () => {
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    state = createAppState();
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  describe('submitReview', () => {
    it('[FR-PRMON-250] should post one review with the head sha, event, body and comments', async () => {
      await submitReview(state, {
        repoFullName: 'org/app',
        prNumber: 7,
        commitId: 'sha-7a',
        event: 'REQUEST_CHANGES',
        body: 'Please fix',
        comments: [{ path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'nit' }],
      });

      expect(stub.requests).toHaveLength(1);
      const [request] = stub.requests;
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/repos/org/app/pulls/7/reviews');
      expect(JSON.parse(request.body)).toEqual({
        commit_id: 'sha-7a',
        event: 'REQUEST_CHANGES',
        body: 'Please fix',
        comments: [{ path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'nit' }],
      });
    });

    it('[FR-PRMON-250] should surface a validation error for a line outside the diff', async () => {
      stub.reply(() => ({
        status: 422,
        body: { message: 'Unprocessable Entity: line must be part of the diff' },
      }));

      await expect(
        submitReview(state, {
          repoFullName: 'org/app',
          prNumber: 7,
          commitId: 'sha-7a',
          event: 'COMMENT',
          body: '',
          comments: [{ path: 'src/a.ts', line: 999, side: 'RIGHT', body: 'nit' }],
        }),
      ).rejects.toMatchObject({ kind: 'validation' });
    });
  });

  describe('fetchPullHeadSha', () => {
    it('[FR-PRMON-250] should read the head sha of the pull request', async () => {
      stub.reply(() => ({ body: { head: { sha: 'sha-7a' } } }));
      await expect(fetchPullHeadSha(state, 'org/app', 7)).resolves.toBe('sha-7a');
    });
  });

  describe('draftsToReviewComments', () => {
    it('[FR-PRMON-250] should skip a draft whose root comment is deleted even when a reply is live', () => {
      const draft = { source: 'local', githubDraft: true, lineNumber: 4, side: 'modified' };

      const comments = draftsToReviewComments([
        {
          documentPath: docPath('src/a.ts'),
          metadata: draft,
          comments: [
            { body: 'root', deletedAt: '2024-01-01T00:00:00Z' },
            { body: 'reply', deletedAt: null },
          ],
        },
      ]);

      expect(comments).toEqual([]);
    });

    it('[FR-PRMON-250] should map a modified-side draft to RIGHT and an original-side draft to LEFT', () => {
      const comments = draftsToReviewComments([
        thread('src/a.ts', {
          source: 'local',
          githubDraft: true,
          lineNumber: 12,
          side: 'modified',
        }),
        thread('src/b.ts', { source: 'local', githubDraft: true, lineNumber: 3, side: 'original' }),
      ]);

      expect(comments).toEqual([
        { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'text' },
        { path: 'src/b.ts', line: 3, side: 'LEFT', body: 'text' },
      ]);
    });

    it('[FR-PRMON-290] should keep only drafts when local, agent and github threads share a diff key', () => {
      const comments = draftsToReviewComments([
        thread('src/a.ts', { source: 'local', lineNumber: 1, side: 'modified' }, 'my note'),
        thread('src/a.ts', { source: 'agent', lineNumber: 2, side: 'modified' }, 'finding'),
        thread('src/a.ts', { source: 'github', lineNumber: 3, side: 'RIGHT' }, 'imported'),
        thread(
          'src/a.ts',
          { source: 'agent', githubDraft: true, lineNumber: 4, side: 'modified' },
          'agent flagged as draft',
        ),
        thread(
          'src/a.ts',
          { source: 'local', githubDraft: true, lineNumber: 5, side: 'modified' },
          'draft',
        ),
      ]);

      expect(comments).toEqual([{ path: 'src/a.ts', line: 5, side: 'RIGHT', body: 'draft' }]);
    });

    it('should skip drafts without a usable line, path or live body', () => {
      const draft = { source: 'local', githubDraft: true, side: 'modified' };
      const comments = draftsToReviewComments([
        thread('src/a.ts', { ...draft, lineNumber: 0 }),
        thread('src/a.ts', { ...draft, lineNumber: 4 }, 'gone', '2024-01-01T00:00:00Z'),
        { documentPath: 'not-a-diff', metadata: { ...draft, lineNumber: 4 }, comments: [] },
      ]);

      expect(comments).toEqual([]);
    });
  });
});
