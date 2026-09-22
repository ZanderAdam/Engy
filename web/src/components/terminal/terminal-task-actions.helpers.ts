export function terminalTaskSlug(workspaceSlug: string, taskId: number): string {
  return `${workspaceSlug}-T${taskId}`;
}

interface TaskOpenDetail {
  taskId: number;
  tab?: 'plan';
  tabId: string | null;
}

export function taskOpenDetail(args: {
  taskId: number;
  tabId: string | null;
  tab?: 'plan';
}): TaskOpenDetail {
  if (args.tab === 'plan') {
    return { taskId: args.taskId, tab: 'plan', tabId: args.tabId };
  }
  return { taskId: args.taskId, tabId: args.tabId };
}
