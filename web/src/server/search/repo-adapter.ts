/**
 * Daemon-backed RepoFileAdapter for routing repo file I/O through the client
 * daemon instead of accessing user repos directly from the server.
 *
 * Use makeDaemonRepoAdapter when a daemon is connected; fall back to the
 * local-fs adapter for colocated dev or when no daemon is available.
 */
import path from 'node:path';
import { localRepoAdapter, type RepoFileAdapter } from '../lib/requirements';
import type { AppState } from '../trpc/context';
import { dispatchGlobFiles, dispatchFileRead, dispatchValidation } from '../ws/server';

/** Glob patterns the scanner uses to find test files. */
const TEST_FILE_PATTERNS = ['*.test.ts', '*.test.tsx'];

/**
 * Create a RepoFileAdapter that dispatches file I/O to the client daemon via
 * the WebSocket protocol. The server never touches the user repo filesystem
 * directly when this adapter is used.
 */
export function makeDaemonRepoAdapter(state: AppState): RepoFileAdapter {
  return {
    async globTestFiles(root: string): Promise<string[]> {
      const result = await dispatchGlobFiles(root, TEST_FILE_PATTERNS, state);
      // The daemon returns paths relative to repoDir; make them absolute.
      return result.files.map((f) => (path.isAbsolute(f) ? f : path.join(root, f)));
    },

    async readFile(absPath: string): Promise<string> {
      // dispatchFileRead expects (repoDir, filePath) where filePath is relative
      // to repoDir. We use the file's dirname as the repoDir context and pass
      // only the basename as the relative path. This is safe because the daemon
      // constructs: path.join(repoDir, filePath).
      const repoDir = path.dirname(absPath);
      const filePath = path.basename(absPath);
      const result = await dispatchFileRead(repoDir, filePath, state);
      return result.content;
    },

    async exists(absPath: string): Promise<boolean> {
      const results = await dispatchValidation([absPath], state);
      return results[0]?.exists ?? false;
    },
  };
}

/**
 * Return the daemon-backed adapter when a daemon is connected, or fall back to
 * the local-fs adapter. This keeps colocated dev and tests (no daemon) working
 * without any code changes.
 */
export function chooseRepoAdapter(state: AppState): RepoFileAdapter {
  if (state.daemon && state.daemon.readyState === state.daemon.OPEN) {
    return makeDaemonRepoAdapter(state);
  }
  return localRepoAdapter;
}
