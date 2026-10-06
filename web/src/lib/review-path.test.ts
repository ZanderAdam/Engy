import { describe, it, expect } from 'vitest';
import { buildPrsPath } from './review-path';

const PR = { repoFullName: 'acme/web', prNumber: 7 };

describe('buildPrsPath', () => {
  it('[FR-PRMON-230] should target the PRs tab of the project with the PR in the query', () => {
    expect(buildPrsPath('my-ws', 'initial', PR)).toBe(
      '/w/my-ws/projects/initial/prs?repo=acme%2Fweb&pr=7',
    );
  });

  it('should return the bare PRs tab path when no PR is given', () => {
    expect(buildPrsPath('my-ws', 'initial', null)).toBe('/w/my-ws/projects/initial/prs');
  });

  it('should keep other query params and replace an earlier PR', () => {
    const current = new URLSearchParams('wt=feat&repo=old%2Frepo&pr=1');

    expect(buildPrsPath('my-ws', 'initial', PR, current)).toBe(
      '/w/my-ws/projects/initial/prs?wt=feat&repo=acme%2Fweb&pr=7',
    );
    expect(buildPrsPath('my-ws', 'initial', null, current)).toBe(
      '/w/my-ws/projects/initial/prs?wt=feat',
    );
  });
});
