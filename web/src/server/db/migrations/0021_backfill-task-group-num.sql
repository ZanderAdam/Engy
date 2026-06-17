-- Backfill num_in_milestone: number each TG within its (project_id, milestone_ref) bucket by id ASC starting at 1.
UPDATE task_groups SET num_in_milestone = (
  SELECT COUNT(*) FROM task_groups AS t2
  WHERE t2.id <= task_groups.id
    AND t2.project_id IS task_groups.project_id
    AND t2.milestone_ref IS task_groups.milestone_ref
);
