interface HeaderAttentionCounts {
  inboxUnreadPriority: number;
  unansweredCount: number;
}

export function hasHeaderAttention({
  inboxUnreadPriority,
  unansweredCount,
}: HeaderAttentionCounts): boolean {
  return inboxUnreadPriority > 0 || unansweredCount > 0;
}
