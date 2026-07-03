'use client';

import { Fragment, useState } from 'react';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiBox3Line,
  RiSplitCellsHorizontal,
  RiSplitCellsVertical,
  RiTerminalLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  toContainerScope,
  type SplitPosition,
  type TerminalDropdownEntry,
  type TerminalDropdownGroup,
  type TerminalScope,
} from './types';

type OpenTerminal = (scope?: TerminalScope, position?: SplitPosition) => void;

// A leaf entry opens a terminal on click. A branch entry (with `children`) is a
// repo expanding to "default branch" + worktrees. On desktop it's a sideways
// submenu (compact); on mobile that submenu would clip off the narrow sheet, so
// it expands INLINE (accordion, indented) instead. Recursive for deeper nesting.
function DropdownEntryItem({
  entry,
  openTerminal,
  inline,
  depth,
}: {
  entry: TerminalDropdownEntry;
  openTerminal: OpenTerminal;
  inline: boolean;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = entry.icon ?? RiTerminalLine;
  const indent = depth > 0 ? { paddingLeft: `${depth * 0.75 + 0.5}rem` } : undefined;

  if (entry.children) {
    if (inline) {
      return (
        <>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setExpanded((v) => !v);
            }}
            title={entry.tooltip}
            style={indent}
          >
            <Icon className="size-3" />
            <span className="truncate">{entry.label}</span>
            <RiArrowDownSLine
              className={cn('ml-auto size-3 transition-transform', expanded && 'rotate-180')}
            />
          </DropdownMenuItem>
          {expanded &&
            entry.children.map((child) => (
              <DropdownEntryItem
                key={child.id}
                entry={child}
                openTerminal={openTerminal}
                inline
                depth={depth + 1}
              />
            ))}
        </>
      );
    }
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger title={entry.tooltip}>
          <Icon className="size-3" />
          <span className="truncate">{entry.label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
          {entry.children.map((child) => (
            <DropdownEntryItem
              key={child.id}
              entry={child}
              openTerminal={openTerminal}
              inline={false}
              depth={0}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  return (
    <DropdownMenuItem onClick={() => openTerminal(entry.scope)} title={entry.tooltip} style={indent}>
      <Icon className="size-3" />
      <span className="truncate">{entry.label}</span>
    </DropdownMenuItem>
  );
}

interface TerminalNewMenuContentProps {
  openTerminal: OpenTerminal;
  // Per-agent entries ("New <Agent> Terminal" + each agent's repo/worktree
  // tree) are threaded in here by the workspace layout, NOT built from the
  // agent-types registry inside this component — the layout owns the repo
  // context needed to construct them.
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
  defaultScope?: TerminalScope;
  inline?: boolean;
  // Split items are dock-only (they need a reference panel). Omit `onSplit` to
  // hide them (e.g. the sidebar rail, which has no panel context).
  onSplit?: (direction: 'right' | 'below') => void;
  splitDisabled?: boolean;
}

// The shared body of the "new terminal" dropdown — rendered identically by the
// dock header actions and the sidebar rail so both surfaces offer the same
// New Terminal / container / split / per-repo-worktree options.
export function TerminalNewMenuContent({
  openTerminal,
  extraDropdownGroups,
  containerEnabled,
  defaultScope,
  inline = false,
  onSplit,
  splitDisabled,
}: TerminalNewMenuContentProps) {
  return (
    <>
      <DropdownMenuItem
        onClick={() =>
          containerEnabled && defaultScope
            ? openTerminal({ ...defaultScope, containerMode: 'host' })
            : openTerminal()
        }
      >
        <RiAddLine className="size-3" />
        New Terminal
      </DropdownMenuItem>
      {containerEnabled && defaultScope && (
        <DropdownMenuItem onClick={() => openTerminal(toContainerScope(defaultScope))}>
          <RiBox3Line className="size-3" />
          New Terminal (Container)
        </DropdownMenuItem>
      )}
      {onSplit && (
        <>
          <DropdownMenuItem onClick={() => onSplit('right')} disabled={splitDisabled}>
            <RiSplitCellsHorizontal className="size-3" />
            Split Right
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSplit('below')} disabled={splitDisabled}>
            <RiSplitCellsVertical className="size-3" />
            Split Down
          </DropdownMenuItem>
        </>
      )}

      {extraDropdownGroups?.map((group, gi) => (
        <Fragment key={group.label ?? gi}>
          <DropdownMenuSeparator />
          {group.label && (
            <DropdownMenuLabel className="text-[10px]">{group.label}</DropdownMenuLabel>
          )}
          {group.entries.map((entry) => (
            <DropdownEntryItem
              key={entry.id}
              entry={entry}
              openTerminal={openTerminal}
              inline={inline}
              depth={0}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}
