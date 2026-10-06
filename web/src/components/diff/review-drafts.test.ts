import { describe, it, expect } from 'vitest';
import { parseDiff } from 'react-diff-view';
import { commentOrigin, isCommentableLine } from './review-drafts';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,5 +10,6 @@ export function a() {
   const one = 1;
   const two = 2;
-  const three = 3;
+  const three = 33;
+  const four = 4;
   return one + two;
 }
@@ -40,3 +41,3 @@ export function b() {
   const x = 1;
-  return x;
+  return x + 1;
 }
`;

const hunks = parseDiff(PATCH)[0].hunks;

describe('isCommentableLine', () => {
  it('[FR-PRMON-240] should allow an added line on the modified side', () => {
    expect(isCommentableLine(hunks, 12, 'modified')).toBe(true);
    expect(isCommentableLine(hunks, 13, 'modified')).toBe(true);
    expect(isCommentableLine(hunks, 14, 'modified')).toBe(true);
  });

  it('[FR-PRMON-240] should allow a deleted line on the original side', () => {
    expect(isCommentableLine(hunks, 12, 'original')).toBe(true);
    expect(isCommentableLine(hunks, 14, 'original')).toBe(true);
    expect(isCommentableLine(hunks, 15, 'original')).toBe(false);
  });

  it('[FR-PRMON-240] should allow context lines inside a hunk on both sides', () => {
    expect(isCommentableLine(hunks, 10, 'modified')).toBe(true);
    expect(isCommentableLine(hunks, 10, 'original')).toBe(true);
  });

  it('[FR-PRMON-240] should refuse lines outside every hunk', () => {
    expect(isCommentableLine(hunks, 5, 'modified')).toBe(false);
    expect(isCommentableLine(hunks, 20, 'modified')).toBe(false);
    expect(isCommentableLine(hunks, 30, 'original')).toBe(false);
    expect(isCommentableLine(hunks, 60, 'modified')).toBe(false);
  });

  it('[FR-PRMON-240] should refuse everything when the patch has no hunks', () => {
    expect(isCommentableLine([], 1, 'modified')).toBe(false);
  });
});

describe('commentOrigin', () => {
  it('[FR-PRMON-290] should tell Engy notes and agent findings apart from GitHub comments', () => {
    expect(commentOrigin({ source: 'local', githubDraft: false })).toBe('engy');
    expect(commentOrigin({ source: 'agent', githubDraft: false })).toBe('engy');
    expect(commentOrigin({ source: 'github', githubDraft: false })).toBe('github');
    expect(commentOrigin({ source: 'local', githubDraft: true })).toBe('github-draft');
  });
});
