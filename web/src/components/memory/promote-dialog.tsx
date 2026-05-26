'use client';

import { useState } from 'react';
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
import { cn } from '@/lib/utils';

interface FleetingMemory {
  id: number;
  content: string;
  type: string;
  tags?: unknown;
}

interface PermanentMemory {
  id: number;
  title: string;
  content: string;
  filePath?: string | null;
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
  const [similarMemories, setSimilarMemories] = useState<PermanentMemory[]>([]);
  const [selectedSupersede, setSelectedSupersede] = useState<number | null>(null);

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

  const searchQuery = trpc.memory.list.useQuery(
    {
      workspaceSlug,
      search: fleeting.content.slice(0, 60),
      limit: 5,
    },
    { enabled: false },
  );

  function resetState() {
    setStep('form');
    setPendingValues(null);
    setSimilarMemories([]);
    setSelectedSupersede(null);
  }

  async function handleFormSubmit(values: MemoryFormValues) {
    setPendingValues(values);

    try {
      const result = await searchQuery.refetch();
      const similar = result.data ?? [];
      if (similar.length > 0) {
        setSimilarMemories(similar as PermanentMemory[]);
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
      choice === 'supersede' && selectedSupersede
        ? [similarMemories.find((m) => m.id === selectedSupersede)?.filePath ?? ''].filter(Boolean)
        : [];

    const promoted = await doPromote(pendingValues, linkedMemories.length > 0 ? linkedMemories : null);

    if (choice === 'supersede' && selectedSupersede && promoted) {
      await updateMutation.mutateAsync({
        id: selectedSupersede,
        supersededById: promoted.id,
      });
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
                <li key={mem.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSupersede(selectedSupersede === mem.id ? null : mem.id)
                    }
                    className={cn(
                      'w-full text-left p-2 border border-border text-xs transition-colors hover:bg-muted/50',
                      selectedSupersede === mem.id && 'border-primary bg-muted/70',
                    )}
                  >
                    <p className="font-medium mb-0.5">{mem.title}</p>
                    <p className="text-muted-foreground line-clamp-2">
                      {mem.content.slice(0, 120)}
                      {mem.content.length > 120 && '…'}
                    </p>
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
                  !selectedSupersede || promoteMutation.isPending || updateMutation.isPending
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
