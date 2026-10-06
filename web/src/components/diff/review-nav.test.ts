import { describe, expect, it } from 'vitest';
import { diffDocPath } from '@/lib/diff-doc-path';
import { stepInList, stepThread, unresolvedThreadOrder } from './review-nav';

function thread(id: string, filePath: string, lineNumber: number, resolved = false) {
  return {
    threadId: id,
    documentPath: diffDocPath('/repo', 'feat/x', filePath),
    lineNumber,
    resolved,
  };
}

describe('stepInList', () => {
  const items = ['a', 'b', 'c'];

  it('should step forward and backward', () => {
    expect(stepInList(items, 'a', 1)).toBe('b');
    expect(stepInList(items, 'c', -1)).toBe('b');
  });

  it('should wrap at both ends', () => {
    expect(stepInList(items, 'c', 1)).toBe('a');
    expect(stepInList(items, 'a', -1)).toBe('c');
  });

  it('should start at the matching end when nothing is current', () => {
    expect(stepInList(items, null, 1)).toBe('a');
    expect(stepInList(items, 'zzz', -1)).toBe('c');
  });

  it('should return null for an empty list', () => {
    expect(stepInList([], null, 1)).toBeNull();
  });
});

describe('unresolvedThreadOrder', () => {
  it('should order threads by file order, then line', () => {
    const threads = [thread('t1', 'b.ts', 5), thread('t2', 'a.ts', 9), thread('t3', 'a.ts', 2)];
    const ordered = unresolvedThreadOrder(threads, ['a.ts', 'b.ts']);
    expect(ordered.map((t) => t.threadId)).toEqual(['t3', 't2', 't1']);
  });

  it('should drop resolved threads and threads outside the file list', () => {
    const threads = [
      thread('t1', 'a.ts', 1, true),
      thread('t2', 'gone.ts', 1),
      thread('t3', 'a.ts', 3),
    ];
    expect(unresolvedThreadOrder(threads, ['a.ts']).map((t) => t.threadId)).toEqual(['t3']);
  });
});

describe('stepThread', () => {
  const cursorOn = (id: string, order: string[]) => ({ id, order });

  it('should step from a cursor that is still unresolved', () => {
    expect(stepThread(cursorOn('b', ['a', 'b', 'c']), ['a', 'b', 'c'], 1)).toBe('c');
    expect(stepThread(cursorOn('b', ['a', 'b', 'c']), ['a', 'b', 'c'], -1)).toBe('a');
  });

  it('should start at the matching end without a cursor', () => {
    expect(stepThread(null, ['a', 'b'], 1)).toBe('a');
    expect(stepThread(null, ['a', 'b'], -1)).toBe('b');
  });

  it('should go to the next unresolved thread when the cursor thread was resolved', () => {
    expect(stepThread(cursorOn('b', ['a', 'b', 'c']), ['a', 'c'], 1)).toBe('c');
  });

  it('should go to the previous unresolved thread when stepping back from a resolved one', () => {
    expect(stepThread(cursorOn('b', ['a', 'b', 'c']), ['a', 'c'], -1)).toBe('a');
  });

  it('should skip several resolved threads', () => {
    expect(stepThread(cursorOn('b', ['a', 'b', 'c', 'd']), ['a', 'd'], 1)).toBe('d');
  });

  it('should wrap when no unresolved thread follows the resolved one', () => {
    expect(stepThread(cursorOn('c', ['a', 'b', 'c']), ['a', 'b'], 1)).toBe('a');
    expect(stepThread(cursorOn('a', ['a', 'b', 'c']), ['b', 'c'], -1)).toBe('c');
  });

  it('should return null when no thread is left', () => {
    expect(stepThread(cursorOn('a', ['a']), [], 1)).toBeNull();
  });
});
