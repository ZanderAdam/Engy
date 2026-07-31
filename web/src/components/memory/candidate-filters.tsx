'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RiSearchLine } from '@remixicon/react';
import { type FleetingType, FLEETING_TYPES } from './types';

export type CandidateSort = 'asc' | 'desc';

export interface CandidateFiltersValue {
  search: string;
  type: FleetingType | '';
  tag: string;
  sort: CandidateSort;
}

export const DEFAULT_CANDIDATE_FILTERS: CandidateFiltersValue = {
  search: '',
  type: '',
  tag: '',
  sort: 'desc',
};

interface CandidateFiltersProps {
  filters: CandidateFiltersValue;
  onChange: (filters: CandidateFiltersValue) => void;
}

const DEBOUNCE_MS = 300;

// Trimmed sibling of MemoryFilters — the review-candidates schema only
// supports a single tag (not an array) and has no repo/confidence axes,
// so a shared abstraction would cost more than it saves.
export function CandidateFilters({ filters, onChange }: CandidateFiltersProps) {
  const [rawSearch, setRawSearch] = useState(filters.search);
  const [rawTag, setRawTag] = useState(filters.tag);

  const latestRef = useRef({ filters, onChange });
  useEffect(() => {
    latestRef.current = { filters, onChange };
  }, [filters, onChange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const { filters: f, onChange: cb } = latestRef.current;
      if (rawSearch !== f.search || rawTag !== f.tag) {
        cb({ ...f, search: rawSearch, tag: rawTag });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawSearch, rawTag]);

  function handleTypeChange(value: string) {
    onChange({ ...filters, type: value === 'all' ? '' : (value as FleetingType) });
  }

  function handleSortChange(value: string) {
    onChange({ ...filters, sort: value as CandidateSort });
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap p-2 border-b border-border">
      <div className="relative flex-1 min-w-32">
        <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-6 h-7 text-xs"
          placeholder="Search candidates..."
          value={rawSearch}
          onChange={(e) => setRawSearch(e.target.value)}
        />
      </div>

      <Select value={filters.type || 'all'} onValueChange={handleTypeChange}>
        <SelectTrigger size="sm" className="h-7 min-w-28">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {FLEETING_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        className="h-7 text-xs w-24"
        placeholder="Tag..."
        value={rawTag}
        onChange={(e) => setRawTag(e.target.value)}
      />

      <Select value={filters.sort} onValueChange={handleSortChange}>
        <SelectTrigger size="sm" className="h-7 min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">Newest first</SelectItem>
          <SelectItem value="asc">Oldest first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
