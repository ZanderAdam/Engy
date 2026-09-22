import { describe, it, expect } from 'vitest';
import { diffUrlParams } from './diff-url-params';

function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe('diff url params', () => {
  it('[FR-GIT-500] should read the repo and view mode a link targets', () => {
    expect(diffUrlParams(params('diffView=branch&diffRepo=/home/dev/proj'))).toEqual({
      repo: '/home/dev/proj',
      view: 'branch',
    });
  });

  it('[FR-GIT-500] should fall back to the page defaults when nothing is targeted', () => {
    expect(diffUrlParams(params(''))).toEqual({ repo: null, view: null });
  });

  it('[FR-GIT-500] should ignore a view mode the page does not have', () => {
    expect(diffUrlParams(params('diffView=sideways')).view).toBeNull();
  });

  // The project nav copies every param onto its section links, so the Tasks
  // page's own `view` must never be read as a diff view mode.
  it("[FR-GIT-500] should ignore another page's view and repo params", () => {
    expect(diffUrlParams(params('view=kanban&repo=/home/dev/other'))).toEqual({
      repo: null,
      view: null,
    });
  });
});
