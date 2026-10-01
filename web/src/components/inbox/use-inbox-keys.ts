import { useEffect, useRef, type RefObject } from 'react';

type InboxKeyAction =
  | 'next'
  | 'previous'
  | 'open'
  | 'close'
  | 'toggleRead'
  | 'markAllRead'
  | 'done'
  | 'snooze'
  | 'github'
  | 'focusFilter'
  | 'help';

type InboxKeyHandlers = Record<InboxKeyAction, () => void>;

interface KeyLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export const INBOX_KEY_HINTS: { keys: string; label: string }[] = [
  { keys: 'j / ArrowDown', label: 'Next item' },
  { keys: 'k / ArrowUp', label: 'Previous item' },
  { keys: 'Enter', label: 'Open review' },
  { keys: 'Esc', label: 'Close an open review' },
  { keys: 'u', label: 'Toggle read' },
  { keys: 'Alt+u', label: 'Mark all read in this tab' },
  { keys: 'e / Backspace', label: 'Done' },
  { keys: 'h', label: 'Snooze' },
  { keys: 'o', label: 'Open on GitHub' },
  { keys: '/', label: 'Filter by title or repo' },
  { keys: '?', label: 'Show this list' },
];

const PLAIN_KEY_ACTIONS: Record<string, InboxKeyAction> = {
  j: 'next',
  ArrowDown: 'next',
  k: 'previous',
  ArrowUp: 'previous',
  Enter: 'open',
  u: 'toggleRead',
  e: 'done',
  Backspace: 'done',
  h: 'snooze',
  o: 'github',
  '/': 'focusFilter',
  '?': 'help',
};

type InboxKeyScope = 'list' | 'review';

const REVIEW_SCOPE_KEYS = new Set(['j', 'k', 'Escape']);

export function getInboxKeyAction(
  e: KeyLike,
  scope: InboxKeyScope = 'list',
): InboxKeyAction | null {
  if (e.ctrlKey || e.metaKey) return null;
  if (scope === 'review') {
    if (e.key === 'Escape') return 'close';
    if (!REVIEW_SCOPE_KEYS.has(e.key)) return null;
  }
  if (e.altKey) return e.code === 'KeyU' ? 'markAllRead' : null;
  return PLAIN_KEY_ACTIONS[e.key] ?? null;
}

const FOCUS_OWNS_KEYS = 'input, textarea, select, [contenteditable="true"], .xterm';

export function focusOwnsKeys(focused: Element | null): boolean {
  return focused?.closest(FOCUS_OWNS_KEYS) != null;
}

const OWNS_ENTER = 'button, a, [role="tab"], [role="combobox"]';
const OWNS_KEYS = '[role="dialog"], [role="menu"], [role="listbox"]';

function targetOwnsKey(target: EventTarget | null, action: InboxKeyAction): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(OWNS_KEYS)) return true;
  return action === 'open' && target.closest(OWNS_ENTER) !== null;
}

export function useInboxKeys(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  handlers: InboxKeyHandlers,
  scope: InboxKeyScope,
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      const container = containerRef.current;
      if (!container || container.offsetWidth === 0) return;
      if (focusOwnsKeys(document.activeElement)) return;

      const action = getInboxKeyAction(e, scope);
      if (!action || targetOwnsKey(e.target, action)) return;

      e.preventDefault();
      handlersRef.current[action]();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [containerRef, enabled, scope]);
}
