'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RiSearchLine, RiCloseLine } from '@remixicon/react';

export type SortOption = 'date' | 'confidence';

export type MemorySubtype = 'decision' | 'pattern' | 'fact' | 'convention' | 'insight';

export interface MemoryFiltersValue {
  search: string;
  subtype: MemorySubtype | '';
  repo: string;
  tags: string[];
  sort: SortOption;
}

interface MemoryFiltersProps {
  filters: MemoryFiltersValue;
  repos: string[];
  disableSubtype?: boolean;
  onChange: (filters: MemoryFiltersValue) => void;
}

const SUBTYPES: { value: MemorySubtype; label: string }[] = [
  { value: 'decision', label: 'Decision' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'fact', label: 'Fact' },
  { value: 'convention', label: 'Convention' },
  { value: 'insight', label: 'Insight' },
];

const DEBOUNCE_MS = 300;

export function MemoryFilters({ filters, repos, disableSubtype, onChange }: MemoryFiltersProps) {
  const [rawSearch, setRawSearch] = useState(filters.search);
  const [tagInput, setTagInput] = useState('');

  const deferredSearch = useDeferredValue(rawSearch);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (deferredSearch !== filters.search) {
        onChange({ ...filters, search: deferredSearch });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [deferredSearch, filters, onChange]);

  function handleSubtypeChange(value: string) {
    onChange({ ...filters, subtype: value === 'all' ? '' : (value as MemorySubtype) });
  }

  function handleRepoChange(value: string) {
    onChange({ ...filters, repo: value === 'all' ? '' : value });
  }

  function handleSortChange(value: string) {
    onChange({ ...filters, sort: value as SortOption });
  }

  function handleTagInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    }
  }

  function addTag(raw: string) {
    const tag = raw.trim().replace(/,$/, '');
    if (tag && !filters.tags.includes(tag)) {
      onChange({ ...filters, tags: [...filters.tags, tag] });
    }
    setTagInput('');
  }

  function removeTag(tag: string) {
    onChange({ ...filters, tags: filters.tags.filter((t) => t !== tag) });
  }

  return (
    <div className="flex flex-col gap-2 p-2 border-b border-border">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative flex-1 min-w-32">
          <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-6 h-7 text-xs"
            placeholder="Search memories..."
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
          />
        </div>

        <Select
          value={filters.subtype || 'all'}
          onValueChange={handleSubtypeChange}
          disabled={disableSubtype}
        >
          <SelectTrigger size="sm" className="h-7 min-w-28">
            <SelectValue placeholder="Subtype" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subtypes</SelectItem>
            {SUBTYPES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {repos.length > 0 && (
          <Select value={filters.repo || 'all'} onValueChange={handleRepoChange}>
            <SelectTrigger size="sm" className="h-7 min-w-24">
              <SelectValue placeholder="Repo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All repos</SelectItem>
              {repos.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={filters.sort} onValueChange={handleSortChange}>
          <SelectTrigger size="sm" className="h-7 min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">By date</SelectItem>
            <SelectItem value="confidence">By confidence</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Input
          className="h-7 text-xs flex-1 min-w-32"
          placeholder="Add tag and press Enter..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagInputKeyDown}
          onBlur={() => tagInput.trim() && addTag(tagInput)}
        />
        {filters.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs h-6">
            {tag}
            <Button
              variant="ghost"
              size="icon"
              className="size-4 hover:bg-transparent"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              <RiCloseLine className="size-3" />
            </Button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
