import { describe, it, expect } from 'vitest';
import { formatCommentsForExport } from './doc-feedback';

const MARKDOWN = 'First paragraph.\nSecond paragraph.\nThird paragraph.';

function block(text: string) {
  return [{ type: 'paragraph', content: [{ type: 'text', text }] }];
}

function thread(
  body: string,
  opts: { resolved?: boolean; exact?: string; deletedAt?: Date | null } = {},
) {
  return {
    resolved: opts.resolved ?? false,
    deletedAt: opts.deletedAt ?? null,
    metadata: opts.exact ? { anchor: { exact: opts.exact } } : {},
    comments: [{ deletedAt: null, body: block(body) }],
  };
}

describe('formatCommentsForExport', () => {
  it('returns empty string when there are no threads', () => {
    expect(formatCommentsForExport({ threads: new Map(), markdown: MARKDOWN })).toBe('');
  });

  it('excludes resolved and deleted threads', () => {
    const threads = new Map([
      ['t1', thread('Resolved note', { resolved: true })],
      ['t2', thread('Deleted note', { deletedAt: new Date() })],
    ]);
    expect(formatCommentsForExport({ threads, markdown: MARKDOWN })).toBe('');
  });

  it('anchors a comment to the line its quote matches', () => {
    const threads = new Map([['t1', thread('Clarify this', { exact: 'Second paragraph.' })]]);
    const result = formatCommentsForExport({ threads, markdown: MARKDOWN });

    expect(result).toContain('Line 2: "Second paragraph."');
    expect(result).toContain('> **user:** Clarify this');
  });

  it('[FR-EDITOR-170] names each thread id so an agent can reply to it', () => {
    const threads = new Map([['abc-123', thread('Clarify this', { exact: 'First paragraph.' })]]);
    const result = formatCommentsForExport({ threads, markdown: MARKDOWN });

    expect(result).toContain('`thread: abc-123`');
  });

  it('[FR-EDITOR-170] tells the agent how to reply when a file path is given', () => {
    const threads = new Map([['abc-123', thread('Clarify this')]]);
    const result = formatCommentsForExport({
      threads,
      markdown: MARKDOWN,
      filePath: 'specs/auth/spec.md',
    });

    expect(result).toContain('# Comments on specs/auth/spec.md');
    expect(result).toContain('replyToComment');
  });

  it('[FR-EDITOR-170] keeps link text and nested list items in a comment', () => {
    const body = [
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'link', href: 'https://x.dev', content: [{ type: 'text', text: 'docs' }] },
        ],
        children: [{ type: 'numberedListItem', content: [{ type: 'text', text: 'step' }] }],
      },
    ];
    const threads = new Map([
      ['t1', { resolved: false, deletedAt: null, metadata: {}, comments: [{ deletedAt: null, body }] }],
    ]);
    const result = formatCommentsForExport({ threads, markdown: MARKDOWN });

    expect(result).toContain('- see docs\n>   1. step');
  });

  it('returns empty string when a file path is given but no thread has comments', () => {
    const threads = new Map([['t1', thread('Resolved note', { resolved: true })]]);
    expect(formatCommentsForExport({ threads, markdown: MARKDOWN, filePath: 'a.md' })).toBe('');
  });

  it('shows the quote without a line number when no markdown is given', () => {
    const threads = new Map([['t1', thread('Clarify this', { exact: 'Second paragraph.' })]]);
    expect(formatCommentsForExport({ threads })).toContain('"Second paragraph."');
    expect(formatCommentsForExport({ threads })).not.toContain('Line 2');
  });
});
