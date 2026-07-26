'use client';

import { useEffect, useRef, useState } from 'react';
import { RiArrowRightSLine, RiLayoutGridLine } from '@remixicon/react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  useTerminalScope,
  useBottomTerminalScope,
} from '@/components/terminal/use-terminal-scope';
import { useOptionalTab } from '@/components/tabs/tab-context';
import { TerminalManager } from '@/components/terminal/terminal-manager';
import {
  useCommandCenterMode,
  setCommandCenterMode,
  COMMAND_CENTER_GROUP_KEY,
} from '@/components/terminal/command-center/use-command-center-mode';
import { cn } from '@/lib/utils';
import type { TerminalDropdownGroup, TerminalScope } from '@/components/terminal/types';
import { useMobileOverlay } from './mobile-overlay-context';

interface MobileTerminalSheetProps {
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
}

interface SheetBaseProps extends MobileTerminalSheetProps {
  overlayKind: 'terminal' | 'shell';
  scope: TerminalScope;
  title: string;
  // The RIGHT (Claude) terminal owns the external terminal:open/inject events.
  // The shell terminal opts out so a single manager handles them on mobile.
  disableExternalEvents?: boolean;
  queueExternalEvents?: boolean;
}

const QUEUED_EVENT_NAMES = ['terminal:open', 'terminal:inject'] as const;

// True once the element's box has held still for a few consecutive frames
// while `open`. The terminal dock must not mount into a still-moving sheet:
// dockview measures its panel overlays at attach time, so mounting during the
// slide-in captures a mid-animation box — and a rapidly toggled (interrupted)
// animation fires no end event to heal from. Frame-stability sidesteps
// animation events entirely.
function useSettledWhenOpen(open: boolean, ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!open) return;

    let rafId = 0;
    let last: DOMRect | null = null;
    let stableFrames = 0;
    const check = () => {
      const rect = ref.current?.getBoundingClientRect();
      const isStable =
        rect != null &&
        last != null &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left === last.left &&
        rect.top === last.top &&
        rect.width === last.width &&
        rect.height === last.height;

      stableFrames = isStable ? stableFrames + 1 : 0;
      if (stableFrames >= 3) {
        setSettled(true);
        return;
      }
      last = rect ?? null;
      rafId = requestAnimationFrame(check);
    };
    rafId = requestAnimationFrame(check);
    // Reset on the way out, not on the way in: closing must re-arm the check so
    // the next open re-measures instead of mounting on a stale "settled".
    return () => {
      cancelAnimationFrame(rafId);
      setSettled(false);
    };
  }, [open, ref]);

  return settled;
}

function MobileTerminalSheetBase({
  overlayKind,
  scope,
  title,
  disableExternalEvents,
  queueExternalEvents,
  extraDropdownGroups,
  containerEnabled,
}: SheetBaseProps) {
  const { overlay, openOverlay, closeOverlay, headerHeight } = useMobileOverlay();
  const tab = useOptionalTab();
  const myTabId = tab?.tabId ?? null;
  const isTabActive = tab?.isActive ?? true;
  const scopeKey = scope.groupKey;
  // Only the active tab's sheet may show. Every open tab mounts its own sheet
  // and the Sheet portals to document.body, so a hidden tab's open sheet would
  // escape its display:none tabpanel and cover the newly activated tab — full
  // screen, because the hidden header measures 0. The overlay state is kept,
  // so returning to the tab restores its terminal.
  const open = overlay === overlayKind && isTabActive;
  const headerOffset = `${headerHeight}px`;
  // Command Center applies to the Claude terminal sheet only (the shell sheet
  // keeps its single scoped terminal). The project's TerminalManager stays
  // mounted underneath so terminal creation keeps working.
  const commandCenterMode = useCommandCenterMode();
  const supportsCommandCenter = overlayKind === 'terminal';
  const showCommandCenter = supportsCommandCenter && commandCenterMode;

  // Queue terminal:open / terminal:inject events fired while the sheet is
  // closed (TerminalManager unmounted, so no listener exists) and replay
  // them once the sheet — and its TerminalManager — has mounted.
  const pendingRef = useRef<Array<{ name: string; detail: unknown }>>([]);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Switching project/workspace changes the terminal's scope, and re-scoping a
  // live session in place isn't supported. Close the sheet on scope change so
  // the user lands on the newly selected project instead of staying on the
  // previous project's terminal. Inactive tabs skip this (openRef is false
  // while hidden); their sheet simply mounts under the new scope when the tab
  // is activated again.
  const prevScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (prevScopeKeyRef.current === scopeKey) return;
    prevScopeKeyRef.current = scopeKey;
    if (openRef.current) closeOverlay();
  }, [scopeKey, closeOverlay]);

  useEffect(() => {
    if (!queueExternalEvents) return;
    function makeHandler(name: string) {
      return (e: Event) => {
        if (openRef.current) return;
        // Events come from the visible UI, so an inactive tab never queues —
        // without this, an event without a tabId would sit in every hidden
        // tab's queue and replay stale whenever that tab is activated.
        if (!isTabActive) return;
        const detail = (e as CustomEvent).detail;
        // Each open tab mounts its own sheet listening on window, and the Sheet
        // portals to document.body (escaping the hidden tab's display:none) — so
        // only the tab that fired the event may respond. Mirrors TerminalManager.
        const tabId = (detail as { tabId?: string | null } | undefined)?.tabId;
        if (tabId !== undefined && tabId !== myTabId) return;
        pendingRef.current.push({ name, detail });
        openOverlay(overlayKind);
      };
    }
    const handlers = QUEUED_EVENT_NAMES.map((name) => {
      const h = makeHandler(name);
      window.addEventListener(name, h);
      return [name, h] as const;
    });
    return () => {
      for (const [name, h] of handlers) window.removeEventListener(name, h);
    };
  }, [queueExternalEvents, openOverlay, overlayKind, myTabId, isTabActive]);

  const contentRef = useRef<HTMLDivElement>(null);
  const settled = useSettledWhenOpen(open, contentRef);
  const managerMounted = open && settled;

  useEffect(() => {
    if (!managerMounted || pendingRef.current.length === 0) return;
    const queued = pendingRef.current;
    pendingRef.current = [];
    // Defer until after TerminalManager mounts and its window listeners attach.
    const id = setTimeout(() => {
      for (const { name, detail } of queued) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      }
    }, 0);
    return () => clearTimeout(id);
  }, [managerMounted]);

  return (
    <Sheet
      open={open}
      // Non-modal so the header above the sheet stays interactive while the
      // terminal is open. Modal mode disables page pointer events + traps
      // focus, which made the first header tap merely dismiss the sheet
      // (requiring a second tap to open the project switcher).
      modal={false}
      onOpenChange={(o) => {
        if (!o) closeOverlay();
      }}
    >
      <SheetContent
        side="right"
        // h-auto (not h-full) so the sheet is sized by top + the inherited
        // bottom:0, sitting below the header's identity bar so workspace/
        // project/tab switching stays reachable while the section-tabs row
        // is covered. Inline top wins over the class top:0.
        className="flex h-auto w-full flex-col gap-0 border-l border-border bg-background p-0"
        showCloseButton={false}
        style={{ top: headerOffset }}
        overlayStyle={{ top: headerOffset }}
        // Non-modal sheets have no backdrop, so tapping the header (project/
        // workspace/tab switching) or its portaled dropdowns must not dismiss
        // the terminal — switching projects and back returns to the same
        // terminal. Close via the chevron, onCollapse, or the header toggle.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={closeOverlay}
            aria-label={`Close ${title.toLowerCase()} terminal`}
          >
            <RiArrowRightSLine className="size-4" />
          </Button>
          <SheetTitle className="text-xs text-muted-foreground">
            {showCommandCenter ? 'Command Center' : title}
          </SheetTitle>
          {supportsCommandCenter ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCommandCenterMode(!commandCenterMode)}
              aria-label="Command Center — all terminals"
              aria-pressed={commandCenterMode}
              className={cn(commandCenterMode && 'bg-muted text-foreground')}
            >
              <RiLayoutGridLine className="size-4" />
            </Button>
          ) : (
            <div className="size-8" aria-hidden />
          )}
        </div>
        <div ref={contentRef} className="flex flex-1 min-h-0 bg-[#0a0a0a]">
          {managerMounted && (
            <TerminalManager
              key={showCommandCenter ? COMMAND_CENTER_GROUP_KEY : scopeKey}
              onCollapse={closeOverlay}
              defaultScope={scope}
              extraDropdownGroups={extraDropdownGroups}
              containerEnabled={containerEnabled}
              disableExternalEvents={disableExternalEvents}
              global={showCommandCenter}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// RIGHT terminal (Claude/agent) — opened from the mobile header. Uses the
// project/workspace Claude scope and owns the terminal:open/inject events.
export function MobileTerminalSheet(props: MobileTerminalSheetProps) {
  const scope = useTerminalScope();
  return (
    <MobileTerminalSheetBase
      overlayKind="terminal"
      scope={scope}
      title="Claude"
      queueExternalEvents
      {...props}
    />
  );
}

// BOTTOM terminal (plain shell) — opened from the floating toggle. Uses the
// shell scope and opts out of external events (the Claude sheet owns those).
export function MobileShellTerminalSheet(props: MobileTerminalSheetProps) {
  const scope = useBottomTerminalScope();
  return (
    <MobileTerminalSheetBase
      overlayKind="shell"
      scope={scope}
      title="Shell"
      disableExternalEvents
      {...props}
    />
  );
}
