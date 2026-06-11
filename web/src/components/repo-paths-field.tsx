'use client';

import { RiAddLine, RiCloseLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { DirPathInput } from '@/components/dir-path-input';
import { Label } from '@/components/ui/label';

interface RepoPathsFieldProps {
  repos: string[];
  onChange: (repos: string[]) => void;
}

export function RepoPathsField({ repos, onChange }: RepoPathsFieldProps) {
  function updateRepo(index: number, value: string) {
    const updated = [...repos];
    updated[index] = value;
    onChange(updated);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Repository paths</Label>
      {repos.map((repo, i) => (
        <div key={i} className="flex gap-2">
          <DirPathInput
            className="flex-1"
            variant="dropdown"
            value={repo}
            onChange={(value) => updateRepo(i, value)}
            placeholder="/path/to/repo"
          />
          {repos.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove path ${i + 1}`}
              onClick={() => onChange(repos.filter((_, idx) => idx !== i))}
            >
              <RiCloseLine />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...repos, ''])}
      >
        <RiAddLine data-icon="inline-start" />
        Add path
      </Button>
    </div>
  );
}
