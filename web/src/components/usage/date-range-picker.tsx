'use client';

import { RiCalendarLine } from '@remixicon/react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PRESETS, matchPreset, resolvePreset, type DateRange, type PresetId } from './date-range';

const CUSTOM = 'custom';

interface DateRangePickerProps {
  range: DateRange;
  now: Date;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ range, now, onChange }: DateRangePickerProps) {
  const preset = matchPreset(range, now);

  function handlePreset(value: string) {
    if (value === CUSTOM) return;
    onChange(resolvePreset(value as PresetId, now));
  }

  function handleFrom(from: string) {
    if (!from) return;
    onChange({ from, to: from > range.to ? from : range.to });
  }

  function handleTo(to: string) {
    if (!to) return;
    onChange({ from: to < range.from ? to : range.from, to });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset ?? CUSTOM} onValueChange={handlePreset}>
        <SelectTrigger size="sm" className="w-36">
          <RiCalendarLine className="size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
          {!preset && (
            <SelectItem value={CUSTOM} disabled>
              Custom
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="Start date"
          className="h-7 w-[8.5rem]"
          value={range.from}
          max={range.to}
          onChange={(e) => handleFrom(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          aria-label="End date"
          className="h-7 w-[8.5rem]"
          value={range.to}
          min={range.from}
          onChange={(e) => handleTo(e.target.value)}
        />
      </div>
    </div>
  );
}
