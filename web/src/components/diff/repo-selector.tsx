'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { repoName } from '@/lib/repo-name';

interface RepoSelectorProps {
  repos: string[];
  selectedRepo: string;
  onSelectRepo: (repo: string) => void;
}

export function RepoSelector({ repos, selectedRepo, onSelectRepo }: RepoSelectorProps) {
  if (repos.length <= 1) return null;

  return (
    <div className="border-b border-border px-3 py-2">
      <Select value={selectedRepo} onValueChange={onSelectRepo}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue placeholder="Select repository" />
        </SelectTrigger>
        <SelectContent>
          <TooltipProvider>
            {repos.map((repo) => (
              <Tooltip key={repo}>
                <TooltipTrigger asChild>
                  <SelectItem value={repo}>{repoName(repo)}</SelectItem>
                </TooltipTrigger>
                <TooltipContent side="right">{repo}</TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </SelectContent>
      </Select>
    </div>
  );
}
