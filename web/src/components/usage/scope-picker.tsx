'use client';

import { cn } from '@/lib/utils';
import type { UsageScope } from './types';

interface ScopePickerProps {
  scope: UsageScope;
  hasProject: boolean;
  onChange: (scope: UsageScope) => void;
}

const OPTIONS: Array<{ value: UsageScope; label: string }> = [
  { value: 'all', label: 'Whole machine' },
  { value: 'workspace', label: 'This workspace' },
  { value: 'project', label: 'This project' },
];

export function ScopePicker({ scope, hasProject, onChange }: ScopePickerProps) {
  const options = hasProject ? OPTIONS : OPTIONS.filter((o) => o.value !== 'project');

  return (
    <div className="flex items-center" role="group" aria-label="Usage scope">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={scope === option.value}
          className={cn(
            'cursor-pointer border border-border px-2 py-1 text-xs transition-colors',
            'not-first:border-l-0',
            scope === option.value
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
