import { describe, it, expect } from 'vitest';
import { generateDiffFeedback, generateGithubFeedback } from './feedback-markdown';
import type { GithubDiffThread } from './feedback-markdown';

const REPO = '/Users/me/repo';

function makeThread(
  filePath: string,
  lineNumber: number,
  text: string,
  opts: { resolved?: boolean; codeLine?: string } = {},
) {
  return {
    documentPath: `diff://${REPO}/${filePath}`,
    resolved: opts.resolved ?? false,
    metadata: { lineNumber, codeLine: opts.codeLine ?? '' },
    comments: [{ body: text, userId: 'user', createdAt: new Date().toISOString() }],
  };
}

describe('generateDiffFeedback', () => {
  it('returns empty string for no threads', () => {
    expect(generateDiffFeedback([], REPO)).toBe('');
  });

  it('returns empty string when all threads are resolved', () => {
    const threads = [makeThread('src/app.ts', 10, 'Fix this', { resolved: true })];
    expect(generateDiffFeedback(threads, REPO)).toBe('');
  });

  it('[FR-GIT-360] generates markdown for a single file', () => {
    const threads = [
      makeThread('src/app.ts', 10, 'Add error handling', { codeLine: 'const x = foo()' }),
    ];
    const result = generateDiffFeedback(threads, REPO);

    expect(result).toContain('## Code Review Feedback');
    expect(result).toContain('1 comment across 1 file');
    expect(result).toContain('### src/app.ts');
    expect(result).toContain('**Line 10**');
    expect(result).toContain('const x = foo()');
    expect(result).toContain('Add error handling');
  });

  it('[FR-GIT-360] omits the code fence when no line was captured', () => {
    const threads = [makeThread('src/app.ts', 10, 'Add error handling')];
    const result = generateDiffFeedback(threads, REPO);

    expect(result).toContain('**Line 10**');
    expect(result).not.toContain('```');
  });

  it('generates markdown for multiple files', () => {
    const threads = [
      makeThread('src/app.ts', 10, 'Fix this'),
      makeThread('src/utils.ts', 5, 'Rename this'),
      makeThread('src/app.ts', 20, 'Add test'),
    ];
    const result = generateDiffFeedback(threads, REPO);

    expect(result).toContain('3 comments across 2 files');
    expect(result).toContain('### src/app.ts');
    expect(result).toContain('### src/utils.ts');
  });

  it('sorts comments by line number within a file', () => {
    const threads = [
      makeThread('src/app.ts', 30, 'Third'),
      makeThread('src/app.ts', 10, 'First'),
      makeThread('src/app.ts', 20, 'Second'),
    ];
    const result = generateDiffFeedback(threads, REPO);

    const firstIdx = result.indexOf('First');
    const secondIdx = result.indexOf('Second');
    const thirdIdx = result.indexOf('Third');

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('excludes resolved threads', () => {
    const threads = [
      makeThread('src/app.ts', 10, 'Keep this'),
      makeThread('src/app.ts', 20, 'Skip this', { resolved: true }),
    ];
    const result = generateDiffFeedback(threads, REPO);

    expect(result).toContain('Keep this');
    expect(result).not.toContain('Skip this');
    expect(result).toContain('1 comment across 1 file');
  });
});

function makeGithubThread(
  filePath: string,
  lineNumber: number,
  body: string,
  opts: { author?: string; url?: string; replies?: Array<{ userId: string; body: string }> } = {},
): GithubDiffThread {
  return {
    documentPath: `diff://${REPO}/${filePath}`,
    lineNumber,
    githubAuthor: opts.author ?? 'alice',
    githubUrl: opts.url,
    comments: [
      { body, userId: opts.author ?? 'alice' },
      ...(opts.replies ?? []).map((r) => ({ body: r.body, userId: r.userId })),
    ],
  };
}

describe('generateGithubFeedback', () => {
  it('returns empty string for no threads', () => {
    expect(generateGithubFeedback([], REPO)).toBe('');
  });

  it('generates GitHub Review Feedback heading', () => {
    const threads = [makeGithubThread('src/app.ts', 10, 'Needs fix', { author: 'bob' })];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).toContain('## GitHub Review Feedback');
    expect(result).toContain('1 comment across 1 file');
  });

  it('includes author attribution in comment text', () => {
    const threads = [makeGithubThread('src/app.ts', 10, 'Fix this', { author: 'carol' })];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).toContain('**carol**:\n> Fix this');
    expect(result).toContain('### src/app.ts');
    expect(result).toContain('**Line 10**');
  });

  it('includes GitHub URL as link when present', () => {
    const threads = [
      makeGithubThread('src/app.ts', 5, 'Comment', {
        url: 'https://github.com/org/repo/pull/1#discussion_r1',
      }),
    ];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).toContain('[view on GitHub](https://github.com/org/repo/pull/1#discussion_r1)');
  });

  it('omits GitHub link section when url is absent', () => {
    const threads = [makeGithubThread('src/app.ts', 5, 'Comment')];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).not.toContain('view on GitHub');
  });

  it('includes reply context with each replier attributed', () => {
    const threads = [
      makeGithubThread('src/app.ts', 10, 'Original comment', {
        author: 'alice',
        replies: [{ userId: 'bob', body: 'Good point!' }],
      }),
    ];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).toContain('**alice**:\n> Original comment');
    expect(result).toContain('**bob**:\n> Good point!');
  });

  it('blockquotes multi-line bodies to prevent markdown injection', () => {
    const threads = [
      makeGithubThread('src/app.ts', 5, '## Spoofed section\nmalicious content', {
        author: 'attacker',
      }),
    ];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).toContain('> ## Spoofed section\n> malicious content');
    expect(result).not.toContain('\n## Spoofed section');
  });

  it('sorts entries by line number within a file', () => {
    const threads = [
      makeGithubThread('src/app.ts', 30, 'Third'),
      makeGithubThread('src/app.ts', 10, 'First'),
      makeGithubThread('src/app.ts', 20, 'Second'),
    ];
    const result = generateGithubFeedback(threads, REPO);

    expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
    expect(result.indexOf('Second')).toBeLessThan(result.indexOf('Third'));
  });

  it('handles multiple files', () => {
    const threads = [
      makeGithubThread('src/a.ts', 1, 'Comment A'),
      makeGithubThread('src/b.ts', 2, 'Comment B'),
    ];
    const result = generateGithubFeedback(threads, REPO);

    expect(result).toContain('2 comments across 2 files');
    expect(result).toContain('### src/a.ts');
    expect(result).toContain('### src/b.ts');
  });
});
