'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface QuickCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
}

export function QuickCaptureDialog({ open, onOpenChange, workspaceSlug }: QuickCaptureDialogProps) {
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const createMutation = trpc.memory.createFleeting.useMutation({
    onSuccess: () => {
      utils.memory.reviewCandidates.invalidate({ workspaceSlug });
      resetAndClose();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function resetAndClose() {
    setContent('');
    setTagsInput('');
    setError(null);
    onOpenChange(false);
  }

  function parseTags(raw: string): string[] {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = content.trim();
    if (!trimmed) return;

    createMutation.mutate({
      workspaceSlug,
      content: trimmed,
      tags: parseTags(tagsInput),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      const trimmed = content.trim();
      if (!trimmed || createMutation.isPending) return;
      setError(null);
      createMutation.mutate({
        workspaceSlug,
        content: trimmed,
        tags: parseTags(tagsInput),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) resetAndClose(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Quick Capture</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="capture-content">Thought</Label>
              <Textarea
                id="capture-content"
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="What's on your mind?"
                rows={4}
                required
              />
              <p className="text-xs text-muted-foreground">
                Press <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-xs">⌘ Enter</kbd> to save quickly.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="capture-tags">Tags (optional)</Label>
              <Input
                id="capture-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="auth, refactor, idea"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !content.trim()}>
              {createMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
