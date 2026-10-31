'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { useOptionalTab, useTabsList } from '@/components/tabs/tab-context';
import { INBOX_KEY_HINTS } from '@/components/inbox/use-inbox-keys';
import { REVIEW_KEY_HINTS } from '@/components/review/use-review-keys';
import { SHORTCUTS, shortcutKeys, shortcutLimit, type ShortcutId } from '@/lib/shortcuts';

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];

interface PageHints {
  title: string;
  hints: { keys: string; label: string }[];
}

function pageHints(virtualPath: string): PageHints[] {
  const isInbox = virtualPath.startsWith('/inbox') || virtualPath.includes('/prs');
  if (!isInbox) return [];
  return [
    { title: 'Inbox', hints: INBOX_KEY_HINTS },
    { title: 'Open review', hints: REVIEW_KEY_HINTS },
  ];
}

function ShortcutRow({ id, label }: { id: ShortcutId; label: string }) {
  const limit = shortcutLimit(id);
  return (
    <li className="flex items-center justify-between gap-4 text-sm">
      <span>
        {label}
        {limit && <span className="block text-xs text-muted-foreground">{limit}</span>}
      </span>
      <KbdGroup>
        {shortcutKeys(id).map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

interface ShortcutHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutHelp({ open, onOpenChange }: ShortcutHelpProps) {
  const isTabActive = useOptionalTab()?.isActive ?? true;
  const tabsList = useTabsList();
  const activePath = tabsList?.tabs.find((t) => t.id === tabsList.activeTabId)?.virtualPath ?? '/';

  return (
    <Dialog open={open && isTabActive} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keys for this device.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <Section key={group} title={group}>
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <ShortcutRow key={s.id} id={s.id} label={s.label} />
              ))}
            </Section>
          ))}
          {pageHints(activePath).map(({ title, hints }) => (
            <Section key={title} title={title}>
              {hints.map((hint) => (
                <li key={hint.keys} className="flex items-center justify-between gap-4 text-sm">
                  <span>{hint.label}</span>
                  <Kbd>{hint.keys}</Kbd>
                </li>
              ))}
            </Section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
