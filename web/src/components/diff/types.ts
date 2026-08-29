export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * Which of a path's two pending changes a row describes: what the index holds
 * relative to the last commit, or what the working tree holds relative to the
 * index. Views without an index to speak of (a commit, a branch range) have
 * neither.
 */
export type DiffSide = 'staged' | 'unstaged';

export interface ChangedFile {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  oldPath?: string;
  /**
   * Blob hash of the file's current content. "Viewed" marks are recorded
   * against it so they expire when the file changes again.
   */
  contentId?: string;
  /** Identity of what the index holds for this path; absent when nothing is staged. */
  indexId?: string;
}

export type ViewMode = 'split' | 'unified';
export type DiffViewMode = 'latest' | 'history' | 'branch';

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}
