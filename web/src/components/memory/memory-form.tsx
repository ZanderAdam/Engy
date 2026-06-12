'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RiCloseLine } from '@remixicon/react';
import { cn } from '@/lib/utils';

import { type MemorySubtype, SUBTYPES } from './types';

export type { MemorySubtype } from './types';

export interface MemoryFormValues {
  title: string;
  content: string;
  subtype: MemorySubtype;
  repo: string;
  tags: string[];
  confidence: number;
}

interface MemoryFormProps {
  defaultValues?: Partial<MemoryFormValues>;
  repos?: string[];
  /** If true, the content field renders read-only (used in promote dialog preview) */
  contentReadOnly?: boolean;
  onSubmit: (values: MemoryFormValues) => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  className?: string;
}

function TagChipInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [tagInput, setTagInput] = useState('');

  function addTag(raw: string) {
    const tag = raw.trim().replace(/,$/, '');
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setTagInput('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    }
    if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        className="h-7 text-xs"
        placeholder="Add tag and press Enter..."
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => tagInput.trim() && addTag(tagInput)}
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs h-5">
              {tag}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-3.5 hover:bg-transparent p-0"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
              >
                <RiCloseLine className="size-2.5" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidenceSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
        className="flex-1 h-1 accent-primary cursor-pointer"
      />
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

export function MemoryForm({
  defaultValues,
  repos = [],
  contentReadOnly = false,
  onSubmit,
  submitLabel = 'Save',
  isSubmitting = false,
  className,
}: MemoryFormProps) {
  const [title, setTitle] = useState(defaultValues?.title ?? '');
  const [content, setContent] = useState(defaultValues?.content ?? '');
  const [subtype, setSubtype] = useState<MemorySubtype>(defaultValues?.subtype ?? 'fact');
  const [repo, setRepo] = useState(defaultValues?.repo ?? '');
  const [tags, setTags] = useState<string[]>(defaultValues?.tags ?? []);
  const [confidence, setConfidence] = useState(defaultValues?.confidence ?? 1.0);

  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});

  function validate(): boolean {
    const next: { title?: string; content?: string } = {};
    if (!title.trim()) next.title = 'Title is required';
    if (!content.trim()) next.content = 'Content is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({ title: title.trim(), content: content.trim(), subtype, repo, tags, confidence });
  }

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <Label htmlFor="memory-title">Title</Label>
        <Input
          id="memory-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A short descriptive title..."
          aria-invalid={!!errors.title}
          className={errors.title ? 'border-destructive' : ''}
        />
        {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="memory-content">Content</Label>
        {contentReadOnly ? (
          <div className="text-xs text-muted-foreground bg-muted/30 border border-border p-2 min-h-16 whitespace-pre-wrap">
            {content}
          </div>
        ) : (
          <textarea
            id="memory-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Describe the memory..."
            rows={4}
            aria-invalid={!!errors.content}
            className={cn(
              'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground flex w-full rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors outline-none focus-visible:ring-1 min-h-16 resize-y',
              errors.content && 'border-destructive',
            )}
          />
        )}
        {errors.content && <p className="text-xs text-destructive">{errors.content}</p>}
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="memory-subtype">Subtype</Label>
          <Select
            value={subtype}
            onValueChange={(v) => setSubtype(v as MemorySubtype)}
          >
            <SelectTrigger id="memory-subtype" size="sm" className="h-7 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUBTYPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {repos.length > 0 && (
          <div className="flex flex-col gap-1 flex-1">
            <Label htmlFor="memory-repo">Repo</Label>
            <Select
              value={repo || '_none'}
              onValueChange={(v) => setRepo(v === '_none' ? '' : v)}
            >
              <SelectTrigger id="memory-repo" size="sm" className="h-7 w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None</SelectItem>
                {repos.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label>Tags</Label>
        <TagChipInput tags={tags} onChange={setTags} />
      </div>

      <div className="flex flex-col gap-1">
        <Label>Confidence</Label>
        <ConfidenceSlider value={confidence} onChange={setConfidence} />
      </div>

      <Button type="submit" size="sm" disabled={isSubmitting} className="self-end">
        {isSubmitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
