'use client';

import { RiMore2Line, RiDraftLine, RiHammerLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

interface TaskQuickActionsProps {
  taskId: number;
  workspaceSlug: string;
  projectDir?: string | null;
  planSlugs?: string[];
  repos?: string[];
}

export function TaskQuickActions({
  taskId,
  workspaceSlug,
  projectDir,
  planSlugs,
  repos = [],
}: TaskQuickActionsProps) {
  const { openNewTerminal } = useSendToTerminal();
  const taskSlug = `${workspaceSlug}-T${taskId}`;
  const hasPlan = planSlugs?.includes(taskSlug) ?? false;

  const workingDir = repos[0] ?? projectDir ?? undefined;
  const additionalDirs = [
    ...(projectDir && projectDir !== workingDir ? [projectDir] : []),
    ...repos.slice(1),
  ];
  const addDirFlags = additionalDirs.map((d) => ` --add-dir '${shellEscape(d)}'`).join('');

  function handlePlan() {
    if (!workingDir || !projectDir) return;
    const escapedDir = shellEscape(projectDir);
    const prompt = `Use /engy:planning to plan ${taskSlug}, output plan to ${escapedDir}/plans/${taskSlug}.plan.md`;
    openNewTerminal({
      scopeType: 'project',
      scopeLabel: `plan: ${taskSlug}`,
      workingDir,
      command: `claude '${shellEscape(prompt)}'${addDirFlags}`,
    });
  }

  function handleImplement() {
    if (!workingDir || !projectDir) return;
    const escapedDir = shellEscape(projectDir);
    const prompt = `Use /engy:implement-plan for ${taskSlug}, plan at ${escapedDir}/plans/${taskSlug}.plan.md`;
    openNewTerminal({
      scopeType: 'project',
      scopeLabel: `impl: ${taskSlug}`,
      workingDir,
      command: `claude '${shellEscape(prompt)}'${addDirFlags}`,
    });
  }

  const actionDisabled = !workingDir || !projectDir;

  const tooltip = actionDisabled
    ? 'No project directory'
    : hasPlan
      ? 'Start Implementing'
      : 'Start Planning';

  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              disabled={actionDisabled}
              onClick={hasPlan ? handleImplement : handlePlan}
            >
              {hasPlan ? <RiHammerLine className="size-3" /> : <RiDraftLine className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {hasPlan && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
            >
              <RiMore2Line className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem disabled={actionDisabled} onClick={handlePlan}>
              <RiDraftLine className="size-4" />
              Replan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
