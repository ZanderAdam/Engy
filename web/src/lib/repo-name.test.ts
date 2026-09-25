import { describe, it, expect } from 'vitest';
import { repoDirByName, repoLinkValue, repoName } from './repo-name';

const ORG1 = '/home/dev/org1/proj';
const ORG2 = '/home/dev/org2/proj';
const OTHER = '/home/dev/other';

describe('repo names in links', () => {
  describe('repoName', () => {
    it('[FR-GIT-500] should take the last path segment', () => {
      expect(repoName('/home/dev/proj/')).toBe('proj');
    });
  });

  describe('repoLinkValue', () => {
    it('[FR-GIT-500] should write the name when it is the only repo with it', () => {
      expect(repoLinkValue(ORG1, [ORG1, OTHER])).toBe('proj');
    });

    it('[FR-GIT-500] should write the path when two repos share a name', () => {
      expect(repoLinkValue(ORG1, [ORG1, ORG2])).toBe(ORG1);
    });
  });

  describe('repoDirByName', () => {
    it('[FR-GIT-500] should resolve a name', () => {
      expect(repoDirByName([ORG1, OTHER], 'proj')).toBe(ORG1);
    });

    it('[FR-GIT-500] should resolve a path, so a shared name stays unambiguous', () => {
      expect(repoDirByName([ORG1, ORG2], ORG2)).toBe(ORG2);
    });

    it('[FR-GIT-500] should report nothing for a repo the workspace dropped', () => {
      expect(repoDirByName([ORG1], 'gone')).toBeNull();
    });
  });
});
