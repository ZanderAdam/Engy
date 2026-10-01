'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ReviewCommentBoxProps {
  workspaceId: number;
  repoFullName: string;
  prNumber: number;
}

export function ReviewCommentBox({ workspaceId, repoFullName, prNumber }: ReviewCommentBoxProps) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const post = trpc.review.comment.useMutation({
    onSuccess: () => utils.review.detail.invalidate(),
  });

  const submit = async () => {
    const body = text.trim();
    if (!body || post.isPending) return;
    setPending(body);
    setText('');
    try {
      await post.mutateAsync({ workspaceId, repoFullName, prNumber, body });
    } catch (error) {
      setText(body);
      toast.error(error instanceof Error ? error.message : 'Could not post the comment');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {pending && (
        <div className="border border-border px-3 py-2 text-xs opacity-60">
          <div className="mb-0.5 text-muted-foreground">Sending…</div>
          <span className="whitespace-pre-wrap">{pending}</span>
        </div>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Leave a comment on this pull request..."
        className="min-h-[72px] resize-none text-xs"
      />
      <div className="flex justify-end">
        <Button size="xs" onClick={() => void submit()} disabled={!text.trim() || post.isPending}>
          Comment
        </Button>
      </div>
    </div>
  );
}
