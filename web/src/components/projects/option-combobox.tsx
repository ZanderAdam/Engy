'use client';

import { useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { withOrphanOptions, type FilterOption } from '@/components/projects/task-filter-options';

interface OptionComboboxProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onSelect: (value: string) => void;
  triggerText: string;
  closeOnSelect?: boolean;
  className?: string;
}

export function OptionCombobox({
  label,
  options,
  selected,
  onSelect,
  triggerText,
  closeOnSelect = false,
  className,
}: OptionComboboxProps) {
  const [open, setOpen] = useState(false);
  const items = withOrphanOptions(options, selected);
  const noun = label.toLowerCase();

  function handleSelect(value: string) {
    onSelect(value);
    if (closeOnSelect) setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'flex w-full items-center justify-between gap-1 rounded-none border border-input/30 bg-input/30 px-2 py-1.5 text-xs hover:bg-muted',
            className,
          )}
        >
          <span className="truncate">{triggerText}</span>
          <RiArrowDownSLine className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${noun}...`} />
          <CommandList>
            <CommandEmpty>No {noun} found.</CommandEmpty>
            {items.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.label}
                data-checked={selected.includes(opt.value)}
                onSelect={() => handleSelect(opt.value)}
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
