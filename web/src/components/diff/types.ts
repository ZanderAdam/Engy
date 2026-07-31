export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

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
}

export type ViewMode = 'split' | 'unified';
export type DiffViewMode = 'latest' | 'history' | 'branch';
export type EditorMode = 'diff' | 'edit';

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}
