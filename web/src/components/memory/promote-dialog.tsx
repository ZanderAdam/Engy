'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MemoryForm, type MemoryFormValues, type MemorySubtype } from './memory-form';
import { toRelativeMemoryPath } from './path-utils';
import { cn } from '@/lib/utils';

interface FleetingMemory {
  id: number;
  content: string;
  type: string;
  tags?: unknown;
}

interface SimilarMemory {
  path: string;
  title: string;
  snippet?: string;
}

interface PromoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fleeting: FleetingMemory;
  workspaceSlug: string;
  repos?: string[];
  onPromoted?: (permanentId: number) => void;
}

type DedupChoice = 'skip' | 'supersede' | 'promote';

export function PromoteDialog({
  open,
  onOpenChange,
  fleeting,
  workspaceSlug,
  repos = [],
  onPromoted,
}: PromoteDialogProps) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<'form' | 'dedup'>('form');
  const [pendingValues, setPendingValues] = useState<MemoryFormValues | null>(null);
  const [similarMemories, setSimilarMemories] = useState<SimilarMemory[]>([]);
  const [selectedSupersedePath, setSelectedSupersedePath] = useState<string | null>(null);

  const proposalQuery = trpc.memory.proposePromotion.useQuery(
    { fleetingMemoryId: fleeting.id },
    {
      enabled: open,
      retry: false,
      staleTime: Infinity,
    },
  );

  const promoteMutation = trpc.memory.promote.useMutation({
    onSuccess: async (result) => {
      await utils.memory.list.invalidate();
      await utils.memory.reviewCandidates.invalidate();
      onPromoted?.(result.id);
      onOpenChange(false);
      resetState();
    },
  });

  const updateMutation = trpc.memory.update.useMutation({
    onSuccess: async () => {
      await utils.memory.list.invalidate();
    },
  });

  const searchQuery = trpc.search.query.useQuery(
    {
      workspaceSlug,
      query: fleeting.content.slice(0, 120),
      collection: 'memory',
      limit: 5,
    },
    { enabled: false },
  );

  function resetState() {
    setStep('form');
    setPendingValues(null);
    setSimilarMemories([]);
    setSelectedSupersedePath(null);
  }

  async function handleFormSubmit(values: MemoryFormValues) {
    setPendingValues(values);

    try {
      const result = await searchQuery.refetch();
      const groups = result.data ?? [];
      const memoryGroup = groups.find((g) => g.collection === 'memory');
      const similar: SimilarMemory[] = (memoryGroup?.results ?? []).map((r) => ({
        path: r.path,
        title: r.title,
        snippet: r.snippet,
      }));
      if (similar.length > 0) {
        setSimilarMemories(similar);
        setStep('dedup');
        return;
      }
    } catch {
      // graceful degradation — fall through to promote
    }

    await doPromote(values, null);
  }

  async function handleDedupChoice(choice: DedupChoice) {
    if (!pendingValues) return;

    if (choice === 'skip') {
      onOpenChange(false);
      resetState();
      return;
    }

    const linkedMemories =
      choice === 'supersede' && selectedSupersedePath
        ? [toRelativeMemoryPath(selectedSupersedePath)]
        : [];

    const promoted = await doPromote(
      pendingValues,
      linkedMemories.length > 0 ? linkedMemories : null,
    );

    if (choice === 'supersede' && selectedSupersedePath && promoted) {
      const supersededTitle =
        similarMemories.find((m) => m.path === selectedSupersedePath)?.title ??
        selectedSupersedePath;
      try {
        const resolved = await utils.memory.getByPath.fetch({
          workspaceSlug,
          filePath: toRelativeMemoryPath(selectedSupersedePath),
        });
        if (resolved) {
          await updateMutation.mutateAsync({
            id: resolved.id,
            supersededById: promoted.id,
          });
        } else {
          toast.warning(`Promoted, but failed to mark "${supersededTitle}" as superseded`);
        }
      } catch {
        toast.warning(`Promoted, but failed to mark "${supersededTitle}" as superseded`);
      }
    }
  }

  async function doPromote(values: MemoryFormValues, linkedMemories: string[] | null) {
    return promoteMutation.mutateAsync({
      fleetingMemoryId: fleeting.id,
      subtype: values.subtype,
      title: values.title,
      content: values.content,
      repo: values.repo || undefined,
      confidence: values.confidence,
      tags: values.tags.length > 0 ? values.tags : undefined,
      linkedMemories: linkedMemories ?? undefined,
    });
  }

  const fleetingTags = Array.isArray(fleeting.tags) ? (fleeting.tags as string[]) : [];
  const proposal = proposalQuery.data;

  // Build form default values: AI proposal takes precedence over fleeting data.
  // When the proposal arrives, we pass a new key to MemoryForm to remount it
  // with the updated defaults (React's cleanest way to reset uncontrolled state).
  const formDefaults: Partial<MemoryFormValues> = proposal
    ? {
        content: fleeting.content,
        title: proposal.title,
        subtype: proposal.subtype as MemorySubtype,
        tags: proposal.tags.length > 0 ? proposal.tags : fleetingTags,
        confidence: proposal.confidence,
        repo: '',
      }
    : {
        content: fleeting.content,
        tags: fleetingTags,
        confidence: 1.0,
      };

  // Key drives MemoryForm remount: changes when proposal arrives.
  const formKey = proposal ? `proposal-${fleeting.id}` : `base-${fleeting.id}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetState();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {step === 'form' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle>Promote to Permanent Memory</DialogTitle>
                {proposal && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    AI proposed
                  </Badge>
                )}
                {proposalQuery.isLoading && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Proposing…
                  </span>
                )}
              </div>
              <DialogDescription>
                Review and refine this fleeting memory before saving it permanently.
              </DialogDescription>
            </DialogHeader>

            <MemoryForm
              key={formKey}
              defaultValues={formDefaults}
              repos={repos}
              onSubmit={handleFormSubmit}
              submitLabel="Promote"
              isSubmitting={promoteMutation.isPending}
            />
          </>
        )}

        {step === 'dedup' && pendingValues && (
          <>
            <DialogHeader>
              <DialogTitle>Similar memories found</DialogTitle>
              <DialogDescription>
                These permanent memories may overlap with the one you are promoting. Choose how to
                proceed.
              </DialogDescription>
            </DialogHeader>

            <ul className="flex flex-col gap-1.5 my-2">
              {similarMemories.map((mem) => (
                <li key={mem.path}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSupersedePath(
                        selectedSupersedePath === mem.path ? null : mem.path,
                      )
                    }
                    className={cn(
                      'w-full text-left p-2 border border-border text-xs transition-colors hover:bg-muted/50',
                      selectedSupersedePath === mem.path && 'border-primary bg-muted/70',
                    )}
                  >
                    <p className="font-medium mb-0.5">{mem.title}</p>
                    {mem.snippet && (
                      <p className="text-muted-foreground line-clamp-2">
                        {mem.snippet.slice(0, 120)}
                        {mem.snippet.length > 120 && '…'}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDedupChoice('skip')}
                disabled={promoteMutation.isPending || updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDedupChoice('promote')}
                disabled={promoteMutation.isPending || updateMutation.isPending}
              >
                Promote anyway
              </Button>
              <Button
                size="sm"
                onClick={() => handleDedupChoice('supersede')}
                disabled={
                  !selectedSupersedePath || promoteMutation.isPending || updateMutation.isPending
                }
              >
                Supersede selected
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
