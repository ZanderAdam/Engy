-- Diff comment threads are now keyed by branch (`diff://<repoDir>#<branch>/<file>`).
-- Threads written under the old branch-less key can never match a scoped read,
-- so they are dropped rather than left to accumulate. GitHub-sourced threads
-- are re-imported by the next PR poll.
--
-- Child rows are deleted explicitly: the cascade depends on `foreign_keys=ON`,
-- which the migration connection does not guarantee.
DELETE FROM `thread_comments` WHERE `thread_id` IN (
  SELECT `id` FROM `comment_threads` WHERE `document_path` LIKE 'diff://%'
);
--> statement-breakpoint
DELETE FROM `comment_threads` WHERE `document_path` LIKE 'diff://%';
