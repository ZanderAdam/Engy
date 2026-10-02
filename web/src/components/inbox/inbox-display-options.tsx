'use client';

import { RiEqualizerLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { InboxSort } from './inbox-helpers';
import type { InboxDisplayOptions } from './use-inbox-display-options';

const SORT_LABELS: Record<InboxSort, string> = {
  activity: 'Activity',
  number: 'PR number',
  shipping: 'Closest to shipping',
};

interface InboxDisplayOptionsProps {
  options: InboxDisplayOptions;
  onChange: (patch: Partial<InboxDisplayOptions>) => void;
}

export function InboxDisplayOptionsMenu({ options, onChange }: InboxDisplayOptionsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Display options">
          <RiEqualizerLine className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 gap-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="inbox-sort">Sort by</Label>
          <Select
            value={options.sort}
            onValueChange={(sort) => onChange({ sort: sort as InboxSort })}
          >
            <SelectTrigger id="inbox-sort" size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as InboxSort[]).map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="inbox-show-snoozed">Show snoozed</Label>
          <Switch
            id="inbox-show-snoozed"
            size="sm"
            checked={options.showSnoozed}
            onCheckedChange={(showSnoozed) => onChange({ showSnoozed })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="inbox-unread-first">Unread first</Label>
          <Switch
            id="inbox-unread-first"
            size="sm"
            checked={options.unreadFirst}
            onCheckedChange={(unreadFirst) => onChange({ unreadFirst })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
