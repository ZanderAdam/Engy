/** The tRPC query-utils surface {@link refreshDiff} needs, narrowed for testing. */
interface DiffQueryUtils {
  diff: { invalidate: () => Promise<void> | void };
  file: { invalidate: () => Promise<void> | void };
}

/**
 * Reload everything the diff surface is showing. The changed-file list and the
 * content of the open panes come from different queries, and refreshing one
 * without the other leaves them describing different moments — the list gaining
 * a file whose diff is still the one fetched minutes ago.
 */
export function refreshDiff(utils: DiffQueryUtils): void {
  void utils.diff.invalidate();
  void utils.file.invalidate();
}
