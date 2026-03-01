"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiChat3Line,
  RiArrowGoBackLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";

interface SpecCommentsProps {
  workspaceSlug: string;
  documentPath: string;
}

export function SpecComments({
  workspaceSlug,
  documentPath,
}: SpecCommentsProps) {
  const [newComment, setNewComment] = useState("");
  const utils = trpc.useUtils();

  const { data: comments, isLoading } = trpc.comment.list.useQuery({
    workspaceSlug,
    documentPath,
  });

  const createMutation = trpc.comment.create.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate({ workspaceSlug, documentPath });
      setNewComment("");
    },
  });

  const resolveMutation = trpc.comment.resolve.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate({ workspaceSlug, documentPath });
    },
  });

  const unresolveMutation = trpc.comment.unresolve.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate({ workspaceSlug, documentPath });
    },
  });

  const deleteMutation = trpc.comment.delete.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate({ workspaceSlug, documentPath });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    createMutation.mutate({
      workspaceSlug,
      documentPath,
      content: newComment.trim(),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-xs text-muted-foreground">Loading comments...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <RiChat3Line className="size-4 text-muted-foreground" />
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Comments
        </h3>
        <span className="text-xs text-muted-foreground">
          ({comments?.length ?? 0})
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {comments?.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No comments yet
            </p>
          )}
          {comments?.map((comment) => (
            <div
              key={comment.id}
              className={cn(
                "rounded border border-border p-2 text-xs",
                comment.resolved && "opacity-50",
              )}
            >
              <p className="whitespace-pre-wrap">{comment.content}</p>
              <div className="mt-2 flex items-center gap-1">
                {comment.resolved ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      unresolveMutation.mutate({
                        workspaceSlug,
                        id: comment.id,
                      })
                    }
                  >
                    <RiArrowGoBackLine className="size-3" />
                    Unresolve
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      resolveMutation.mutate({
                        workspaceSlug,
                        id: comment.id,
                      })
                    }
                  >
                    <RiCheckLine className="size-3" />
                    Resolve
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive"
                  onClick={() =>
                    deleteMutation.mutate({
                      workspaceSlug,
                      id: comment.id,
                    })
                  }
                >
                  <RiDeleteBinLine className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          className="mb-2 text-xs min-h-[60px]"
        />
        <Button
          type="submit"
          size="sm"
          disabled={createMutation.isPending || !newComment.trim()}
        >
          {createMutation.isPending ? "Posting..." : "Post"}
        </Button>
      </form>
    </div>
  );
}
