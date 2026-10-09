UPDATE inbox_items SET pr_state = COALESCE((
  SELECT CASE e.kind WHEN 'reopened' THEN 'open' ELSE e.kind END
  FROM inbox_events AS e
  WHERE e.item_id = inbox_items.id AND e.kind IN ('merged', 'closed', 'reopened')
  ORDER BY e.at DESC, e.id DESC
  LIMIT 1
), 'open');
