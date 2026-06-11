'use client';

import path from 'path';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { RiFolderLine, RiLoader4Line, RiArrowUpLine } from '@remixicon/react';
import { parseBrowsePath, filterDirs, pickAutocompleteMatch } from './dir-path-input.helpers';

interface DirPathInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * 'inline' — always-visible bordered list below the input (open-dir style).
   * 'dropdown' — list floats absolutely under the input, visible only while focused.
   */
  variant: 'inline' | 'dropdown';
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /**
   * Called when Enter is pressed and no suggestion is highlighted.
   * If undefined the event is not prevented (falls through to form submit).
   */
  onEnter?: () => void;
}

export function DirPathInput({
  value,
  onChange,
  variant,
  id,
  placeholder,
  autoFocus,
  className,
  onEnter,
}: DirPathInputProps) {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { browsePath, filter } = parseBrowsePath(value);

  // Reset selection when the browse path changes (render-time adjustment,
  // see react.dev "You Might Not Need an Effect").
  const [prevBrowsePath, setPrevBrowsePath] = useState(browsePath);
  if (prevBrowsePath !== browsePath) {
    setPrevBrowsePath(browsePath);
    setSelectedIndex(-1);
  }

  const showSuggestions = variant === 'inline' || focused;

  const { data, isLoading, isError } = trpc.file.listDir.useQuery(
    { dirPath: browsePath },
    {
      enabled: !!browsePath && showSuggestions,
      retry: false,
    },
  );

  // Clear the pending blur timer on unmount.
  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    [],
  );

  // Scroll the selected item into view.
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      listRef.current
        .querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // No suggestions when the query errored (e.g. no daemon connected).
  const rawDirs = isError ? [] : (data?.dirs ?? []);
  const filteredDirs = filterDirs(rawDirs, filter);

  function navigateTo(dir: string) {
    setSelectedIndex(-1);
    onChange(path.join(browsePath, dir) + '/');
  }

  function goUp() {
    const parent = path.dirname(browsePath);
    if (parent !== browsePath) {
      setSelectedIndex(-1);
      onChange(parent + '/');
    }
  }

  function handleInputChange(newValue: string) {
    setSelectedIndex(-1);
    // On '/' typed: autocomplete if exact or single match exists.
    if (newValue.endsWith('/') && !value.endsWith('/') && filter) {
      const match = pickAutocompleteMatch(filteredDirs, filter);
      if (match) {
        onChange(path.join(browsePath, match) + '/');
        return;
      }
    }
    onChange(newValue);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) =>
        filteredDirs.length > 0 ? Math.min(i + 1, filteredDirs.length - 1) : -1,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const target = filteredDirs[selectedIndex >= 0 ? selectedIndex : 0];
      if (target) navigateTo(target);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && filteredDirs[selectedIndex]) {
        e.preventDefault();
        navigateTo(filteredDirs[selectedIndex]);
      } else if (onEnter) {
        onEnter();
      }
      // No selection + no onEnter → fall through so a surrounding form submits.
    }
  }

  function handleFocus() {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setFocused(true);
  }

  function handleBlur() {
    // Small delay so clicking a suggestion item fires before focus is lost.
    blurTimerRef.current = setTimeout(() => setFocused(false), 150);
  }

  const canGoUp = !!browsePath && path.dirname(browsePath) !== browsePath;

  const shouldRenderList = showSuggestions && !!browsePath && !isError;
  const hasList = shouldRenderList && (canGoUp || isLoading || filteredDirs.length > 0);

  const listContent = shouldRenderList ? (
    <div ref={listRef} className="max-h-56 overflow-y-auto">
      {canGoUp && (
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-xs hover:bg-accent/50"
          onMouseDown={(e) => e.preventDefault()}
          onClick={goUp}
        >
          <RiArrowUpLine className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">..</span>
        </button>
      )}
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <RiLoader4Line className="size-3 animate-spin" /> Loading…
        </div>
      )}
      {!isLoading && !isError && filteredDirs.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">No matches</p>
      )}
      {filteredDirs.map((dir, index) => (
        <button
          key={dir}
          data-index={index}
          type="button"
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
            index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => navigateTo(dir)}
        >
          <RiFolderLine className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{dir}</span>
        </button>
      ))}
    </div>
  ) : null;

  if (variant === 'inline') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <Input
          id={id}
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="font-mono text-xs"
        />
        <div className="overflow-hidden rounded border border-border">{listContent}</div>
      </div>
    );
  }

  // Dropdown variant: list floats absolutely under the input.
  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="font-mono text-xs"
      />
      {hasList && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded border border-border bg-popover shadow-md">
          {listContent}
        </div>
      )}
    </div>
  );
}
