"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  useCreateBlockNote,
  BlockNoteViewEditor,
  ThreadsSidebar,
  FloatingComposerController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { CommentsExtension } from "@blocknote/core/comments";
import type { User } from "@blocknote/core/comments";
import "@blocknote/shadcn/style.css";
import "@blocknote/react/style.css";
import { Button } from "@/components/ui/button";
import {
  RiFileCopyLine,
  RiCheckLine,
  RiChat3Line,
  RiCloseLine,
  RiDownloadLine,
} from "@remixicon/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InMemoryThreadStore, DefaultThreadStoreAuth } from "./thread-store";
import type { CommentStore } from "./thread-store";
import { snapshotAnchors } from "./comments/snapshot";
import { reconcileAnchors } from "./comments/reconcile";
import { formatCommentsForExport } from "./format-comments";
import { SendToTerminalButton } from "../terminal/send-to-terminal-button";
import { trpc } from "@/lib/trpc";
import { stripFrontmatter } from "./frontmatter";
import { normalizeMarkdown } from "./remark-normalize";
import { mermaidBlockSpec } from "./mermaid/block";
import { insertMermaidItem } from "./mermaid/slash-menu";
import { codeBlockToMermaid, mermaidToCodeBlock } from "./mermaid/markdown-bridge";

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaid: mermaidBlockSpec(),
  },
});

export { EngyThreadStore } from "./thread-store";

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

const USER_ID = "local-user";
const LOCAL_USER: User = { id: USER_ID, username: "You", avatarUrl: "" };

async function resolveUsers(userIds: string[]): Promise<User[]> {
  return userIds.map((id) =>
    id === USER_ID ? LOCAL_USER : { id, username: id, avatarUrl: "" },
  );
}

interface DocumentEditorProps {
  /** Initial markdown content */
  initialMarkdown: string;
  /** Called on autosave with markdown content */
  onSave: (markdown: string) => void;
  /** Enable inline comments (default: false) */
  comments?: boolean;
  /** External thread store (persists across editor remounts) */
  threadStore?: CommentStore;
  /** File path displayed in comment exports */
  filePath?: string;
  /** Directories to index for @ file mentions */
  mentionDirs?: string[];
}

/** Imperative handle for DocumentEditor. Callers hold a ref to flush pending saves. */
export interface DocumentEditorHandle {
  /**
   * Cancel any pending debounced autosave, synchronously extract the current
   * markdown, invoke `onSave` with it, and return the content. Used when
   * downstream actions (publish, push to agent, etc.) need the latest content
   * without waiting for the autosave debounce.
   */
  flush: () => string;
}

const AUTOSAVE_DELAY_MS = 1500;

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function DocumentEditor({
  initialMarkdown,
  onSave,
  comments = false,
  threadStore: externalThreadStore,
  filePath,
  mentionDirs,
}, handleRef) {
  const { resolvedTheme } = useTheme();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedHashRef = useRef<number | null>(null);
  const lastContentHashRef = useRef<number | null>(null);
  const frontmatterRef = useRef('');
  const [hasOpenThreads, setHasOpenThreads] = useState(false);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  const internalStore = useMemo(() => {
    const auth = new DefaultThreadStoreAuth(USER_ID, 'editor');
    return new InMemoryThreadStore(USER_ID, auth);
  }, []);

  const threadStore: CommentStore = externalThreadStore ?? internalStore;

  useEffect(() => {
    const checkOpen = () =>
      Array.from(threadStore.getThreads().values()).some((t) => !t.resolved && !t.deletedAt);
    setHasOpenThreads(checkOpen());
    return threadStore.subscribe(() => {
      setHasOpenThreads(checkOpen());
    });
  }, [threadStore]);

  const utils = trpc.useUtils();
  const mentionDirsRef = useRef(mentionDirs);
  useEffect(() => { mentionDirsRef.current = mentionDirs; }, [mentionDirs]);

  const editor = useCreateBlockNote(
    {
      schema,
      extensions: comments ? [CommentsExtension({ threadStore, resolveUsers })] : undefined,
    },
    [threadStore],
  );

  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getMentionItems = useCallback(
    (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const dirs = mentionDirsRef.current;
      if (!dirs || dirs.length === 0) return Promise.resolve([]);

      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);

      return new Promise((resolve) => {
        fetchTimeoutRef.current = setTimeout(async () => {
          try {
            const { results } = await utils.dir.searchRepoFiles.fetch({
              dirs,
              query,
              limit: 20,
            });

            resolve(
              results.map(({ label, path: filePath }) => {
                const fullPath = `${label}/${filePath}`;
                return {
                  title: fullPath,
                  group: label,
                  onItemClick: () => {
                    editor.insertInlineContent([
                      { type: 'text', text: fullPath, styles: {} },
                      ' ',
                    ]);
                  },
                };
              }),
            );
          } catch {
            resolve([]);
          }
        }, 200);
      });
    },
    [utils, editor],
  );

  const readyRef = useRef(false);

  useEffect(() => {
    if (initialMarkdown == null) return;
    const { header, body } = stripFrontmatter(initialMarkdown);
    frontmatterRef.current = header;

    const hash = simpleHash(body);
    if (lastLoadedHashRef.current === hash) return;
    // Own save roundtripped back via file watcher — skip disruptive reload
    if (lastContentHashRef.current === hash) {
      lastLoadedHashRef.current = hash;
      return;
    }

    lastLoadedHashRef.current = hash;
    lastContentHashRef.current = hash;
    readyRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    async function loadContent() {
      const blocks = editor.tryParseMarkdownToBlocks(body);
      const transformed = codeBlockToMermaid(blocks);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.replaceBlocks(editor.document, transformed as any);
      if (comments) {
        await threadStore.ready;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reconcileAnchors((editor as any)._tiptapEditor, threadStore);
      }
      setTimeout(() => { readyRef.current = true; }, 500);
    }
    loadContent();
  }, [editor, initialMarkdown, comments, threadStore]);

  const handleChange = useCallback(() => {
    if (!readyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      if (comments) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotAnchors((editor as any)._tiptapEditor.state.doc, threadStore);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = editor.blocksToMarkdownLossy(mermaidToCodeBlock(editor.document as any) as any);
      const markdown = normalizeMarkdown(raw);

      const contentHash = simpleHash(markdown);
      if (contentHash === lastContentHashRef.current) return;
      lastContentHashRef.current = contentHash;
      lastLoadedHashRef.current = contentHash;
      onSaveRef.current(frontmatterRef.current + markdown);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setShowSaved(true);
      savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000);
    }, AUTOSAVE_DELAY_MS);
  }, [editor, comments, threadStore]);

  useImperativeHandle(
    handleRef,
    () => ({
      flush: () => {
        // Cancel any in-flight debounce; we're persisting right now.
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (!readyRef.current) {
          return frontmatterRef.current;
        }
        if (comments) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          snapshotAnchors((editor as any)._tiptapEditor.state.doc, threadStore);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = editor.blocksToMarkdownLossy(mermaidToCodeBlock(editor.document as any) as any);
        const markdown = normalizeMarkdown(raw);
        const full = frontmatterRef.current + markdown;
        const contentHash = simpleHash(markdown);
        if (contentHash !== lastContentHashRef.current) {
          lastContentHashRef.current = contentHash;
          lastLoadedHashRef.current = contentHash;
          onSaveRef.current(full);
        }
        return full;
      },
    }),
    [editor, comments, threadStore],
  );

  const getFormattedComments = useCallback(() => {
    const threads = threadStore.getThreads();
    if (threads.size === 0) return '';

    const markdown = normalizeMarkdown(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.blocksToMarkdownLossy(mermaidToCodeBlock(editor.document as any) as any),
    );
    return formatCommentsForExport({ threads, markdown, filePath });
  }, [threadStore, editor, filePath]);

  const handleCopyComments = useCallback(() => {
    const formatted = getFormattedComments();
    if (!formatted) return;

    navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [getFormattedComments]);

  const getCurrentMarkdown = useCallback(() => {
    return normalizeMarkdown(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.blocksToMarkdownLossy(mermaidToCodeBlock(editor.document as any) as any),
    );
  }, [editor]);

  const handleCopyMarkdown = useCallback(() => {
    navigator.clipboard.writeText(getCurrentMarkdown()).then(() => {
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 2000);
    });
  }, [getCurrentMarkdown]);

  const handleDownloadMarkdown = useCallback(() => {
    const markdown = getCurrentMarkdown();
    const filename = filePath ? filePath.split('/').pop() ?? 'document.md' : 'document.md';
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getCurrentMarkdown, filePath]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (comments) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotAnchors((editor as any)._tiptapEditor.state.doc, threadStore);
      }
    };
  }, [editor, comments, threadStore]);

  return (
    <BlockNoteView
      editor={editor}
      onChange={handleChange}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      renderEditor={false}
      comments={false}
      slashMenu={false}
    >
      {comments && <FloatingComposerController />}
      {mentionDirs && mentionDirs.length > 0 && (
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={getMentionItems}
          minQueryLength={1}
        />
      )}
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const defaults = getDefaultReactSlashMenuItems(editor as any);
          // Mermaid uses its own "Diagrams" group so it can't collide with
          // any default group (BlockNote uses each group name as a React key
          // for the menu's section label, so reusing an existing group on a
          // non-contiguous item would produce duplicate-key warnings).
          const items: DefaultReactSuggestionItem[] = [
            ...defaults,
            insertMermaidItem(editor),
          ];
          if (!query) return items;
          const q = query.toLowerCase();
          return items.filter((item) => {
            if (item.title.toLowerCase().includes(q)) return true;
            const aliases = (item as { aliases?: string[] }).aliases;
            return aliases?.some((a) => a.toLowerCase().includes(q)) ?? false;
          });
        }}
      />
      <div className="relative flex w-full h-full overflow-hidden">
        <div className="relative flex-1 min-w-0 overflow-y-auto">
          <BlockNoteViewEditor />
          <TooltipProvider delayDuration={300}>
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyMarkdown}
                    className="h-6 w-6 p-0 text-muted-foreground"
                  >
                    {copiedMarkdown ? (
                      <RiCheckLine className="size-3 text-green-500" />
                    ) : (
                      <RiFileCopyLine className="size-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{copiedMarkdown ? 'Copied!' : 'Copy markdown'}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadMarkdown}
                    className="h-6 w-6 p-0 text-muted-foreground"
                  >
                    <RiDownloadLine className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Download markdown</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
          {showSaved && (
            <span className="absolute bottom-3 right-3 text-xs text-muted-foreground/70 animate-in fade-in duration-200">
              Saved
            </span>
          )}
        </div>
        {comments && hasOpenThreads && !commentsCollapsed && (
          <div className="w-72 border-l border-border overflow-y-auto shrink-0">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Comments</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyComments}
                  className="h-6 px-2 text-xs"
                >
                  {copied ? (
                    <>
                      <RiCheckLine className="size-3 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <RiFileCopyLine className="size-3 mr-1" />
                      Copy All
                    </>
                  )}
                </Button>
                <SendToTerminalButton getContent={getFormattedComments} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCommentsCollapsed(true)}
                  className="h-6 px-1.5 text-xs text-muted-foreground"
                  title="Collapse comments"
                >
                  <RiCloseLine className="size-3" />
                </Button>
              </div>
            </div>
            <div className="p-3">
              <ThreadsSidebar filter="open" sort="position" />
            </div>
          </div>
        )}
        {comments && hasOpenThreads && commentsCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommentsCollapsed(false)}
            className="absolute right-2 top-2 z-10 h-7 px-2 text-xs text-muted-foreground"
            title="Show comments"
          >
            <RiChat3Line className="size-3.5 mr-1" />
            Comments
          </Button>
        )}
      </div>
    </BlockNoteView>
  );
});
