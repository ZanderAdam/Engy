'use client';

import { useState } from 'react';
import {
  RiFilterLine,
  RiDraftLine,
  RiHammerLine,
  RiArrowDownSLine,
  RiRobotLine,
  RiUserLine,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Switch } from '@/components/ui/switch';
import {
  taskStatusOptions,
  taskStatusColors,
  taskStatusIcons,
  taskStatusLabels,
} from '@/components/projects/task-status-badge';
import { withOrphanOptions, type FilterOption } from '@/components/projects/task-filter-options';
import { cn } from '@/lib/utils';

export interface TaskFilters {
  status: string[];
  type: string[];
  groupId: number[];
  milestoneRef: string[];
  unassignedOnly: boolean;
  doneLimit: number;
  planStatus: string[];
}

export const DEFAULT_DONE_LIMIT = 5;

export function emptyFilters(): TaskFilters {
  return {
    status: [],
    type: [],
    groupId: [],
    milestoneRef: [],
    unassignedOnly: true,
    doneLimit: DEFAULT_DONE_LIMIT,
    planStatus: [],
  };
}

function clearedFilters(): TaskFilters {
  return { ...emptyFilters(), unassignedOnly: false };
}

export function applyTaskFilters<
  T extends {
    status: string;
    type: string;
    taskGroupId: number | null;
    milestoneRef: string | null;
    needsPlan?: boolean;
  },
>(tasks: T[], filters: TaskFilters): T[] {
  return tasks.filter((task) => {
    if (filters.status.length > 0 && !filters.status.includes(task.status)) return false;
    if (filters.type.length > 0 && !filters.type.includes(task.type)) return false;
    if (filters.groupId.length > 0 && !filters.groupId.includes(task.taskGroupId ?? -1))
      return false;
    if (
      filters.milestoneRef.length > 0 &&
      (!task.milestoneRef || !filters.milestoneRef.includes(task.milestoneRef))
    )
      return false;
    if (filters.unassignedOnly && (task.milestoneRef !== null || task.taskGroupId !== null))
      return false;
    if (filters.planStatus.length > 0) {
      const taskPlanStatus = task.needsPlan ? 'needs_plan' : 'ready';
      if (!filters.planStatus.includes(taskPlanStatus)) return false;
    }
    return true;
  });
}

function countActiveFilters(filters: TaskFilters): number {
  let count =
    filters.status.length +
    filters.type.length +
    filters.groupId.length +
    filters.milestoneRef.length +
    filters.planStatus.length;
  if (filters.unassignedOnly) count++;
  if (filters.doneLimit !== DEFAULT_DONE_LIMIT) count++;
  return count;
}

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function FilterChip({
  selected,
  onClick,
  icon: Icon,
  label,
  activeClass,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 border px-2 py-1 text-xs font-medium transition-colors',
        selected
          ? cn('border-border bg-muted', activeClass)
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {label}
    </button>
  );
}

const SECTION_LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

interface MultiSelectComboboxProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function MultiSelectCombobox({ label, options, selected, onChange }: MultiSelectComboboxProps) {
  const [open, setOpen] = useState(false);
  const items = withOrphanOptions(options, selected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-none border border-input/30 bg-input/30 px-2 py-1.5 text-xs hover:bg-muted"
        >
          <span className="truncate text-muted-foreground">
            {selected.length > 0
              ? `${selected.length} selected`
              : `Select ${label.toLowerCase()}...`}
          </span>
          <RiArrowDownSLine className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No {label.toLowerCase()} found.</CommandEmpty>
            {items.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.label}
                data-checked={selected.includes(opt.value)}
                onSelect={() => onChange(toggle(selected, opt.value))}
              >
                {opt.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const DONE_LIMIT_OPTIONS = [5, 10, 25, 0] as const;

function doneLimitLabel(limit: number): string {
  return limit === 0 ? 'All' : String(limit);
}

const typeConfig = [
  { value: 'ai', label: 'AI', icon: RiRobotLine },
  { value: 'human', label: 'Human', icon: RiUserLine },
] as const;

const planStatusConfig = [
  { value: 'needs_plan', label: 'Needs plan', icon: RiDraftLine },
  { value: 'ready', label: 'Ready', icon: RiHammerLine },
] as const;

interface TaskFilterProps {
  value: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  groups: { id: number; name: string }[];
  milestones: { ref: string; title: string }[];
}

export function TaskFilter({ value, onChange, groups, milestones }: TaskFilterProps) {
  const activeCount = countActiveFilters(value);
  const showMilestones = milestones.length > 0 || value.milestoneRef.length > 0;
  const showGroups = groups.length > 0 || value.groupId.length > 0;

  function handleUnassignedToggle(checked: boolean) {
    if (checked) {
      onChange({ ...value, unassignedOnly: true, milestoneRef: [], groupId: [] });
    } else {
      onChange({ ...value, unassignedOnly: false });
    }
  }

  function handleMilestoneChange(selected: string[]) {
    const next: Partial<TaskFilters> = { milestoneRef: selected };
    if (selected.length > 0 && value.unassignedOnly) next.unassignedOnly = false;
    onChange({ ...value, ...next });
  }

  function handleGroupChange(selected: number[]) {
    const next: Partial<TaskFilters> = { groupId: selected };
    if (selected.length > 0 && value.unassignedOnly) next.unassignedOnly = false;
    onChange({ ...value, ...next });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <RiFilterLine data-icon="inline-start" />
          Filter
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem]">
        <div className="flex flex-col gap-3">
          {activeCount > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onChange(clearedFilters())}
                className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Status */}
          <div>
            <div className={SECTION_LABEL}>Status</div>
            <div className="flex gap-1">
              {taskStatusOptions.map((s) => {
                const Icon = taskStatusIcons[s];
                return (
                  <FilterChip
                    key={s}
                    selected={value.status.includes(s)}
                    onClick={() => onChange({ ...value, status: toggle(value.status, s) })}
                    icon={Icon}
                    label={taskStatusLabels[s] ?? s}
                    activeClass={taskStatusColors[s]}
                  />
                );
              })}
            </div>
          </div>

          {/* Type + Plan Status */}
          <div className="flex gap-6">
            <div>
              <div className={SECTION_LABEL}>Type</div>
              <div className="flex gap-1">
                {typeConfig.map((t) => (
                  <FilterChip
                    key={t.value}
                    selected={value.type.includes(t.value)}
                    onClick={() => onChange({ ...value, type: toggle(value.type, t.value) })}
                    icon={t.icon}
                    label={t.label}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className={SECTION_LABEL}>Plan Status</div>
              <div className="flex gap-1">
                {planStatusConfig.map((p) => (
                  <FilterChip
                    key={p.value}
                    selected={value.planStatus.includes(p.value)}
                    onClick={() =>
                      onChange({ ...value, planStatus: toggle(value.planStatus, p.value) })
                    }
                    icon={p.icon}
                    label={p.label}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Done limit + Unassigned */}
          <div className="flex items-end gap-6">
            <div>
              <div className={SECTION_LABEL}>Done limit</div>
              <div className="flex gap-1">
                {DONE_LIMIT_OPTIONS.map((limit) => (
                  <FilterChip
                    key={limit}
                    selected={value.doneLimit === limit}
                    onClick={() => onChange({ ...value, doneLimit: limit })}
                    label={doneLimitLabel(limit)}
                  />
                ))}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2 pb-1">
              <span className={SECTION_LABEL.replace('mb-1 ', '')}>Unassigned only</span>
              <Switch
                size="sm"
                checked={value.unassignedOnly}
                onCheckedChange={handleUnassignedToggle}
              />
            </div>
          </div>

          {/* Milestone + Group comboboxes */}
          {(showMilestones || showGroups) && (
            <div className="flex gap-3">
              {showMilestones && (
                <div className="flex-1">
                  <div className={SECTION_LABEL}>Milestone</div>
                  <MultiSelectCombobox
                    label="Milestones"
                    options={milestones.map((m) => ({ value: m.ref, label: m.title }))}
                    selected={value.milestoneRef}
                    onChange={handleMilestoneChange}
                  />
                </div>
              )}
              {showGroups && (
                <div className="flex-1">
                  <div className={SECTION_LABEL}>Group</div>
                  <MultiSelectCombobox
                    label="Groups"
                    options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
                    selected={value.groupId.map(String)}
                    onChange={(selected) => handleGroupChange(selected.map(Number))}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
