import type { TerminalScope } from './types';

// Shared by `TerminalSessionLabel` and the dock tab's own render so the two surfaces cannot drift.
export function resolveTerminalLabel(scope: TerminalScope, oscTitle?: string): string {
  return scope.renamedLabel ?? oscTitle ?? scope.scopeLabel;
}

export function resolveRenameSeed(scope: TerminalScope): string {
  return scope.renamedLabel ?? scope.scopeLabel;
}
