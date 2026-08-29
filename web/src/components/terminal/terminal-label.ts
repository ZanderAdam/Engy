import type { TerminalScope } from './types';

/**
 * Main-line label precedence, shared by `TerminalSessionLabel` and the dock
 * tab's own render so the two surfaces cannot drift: a manual rename always
 * wins, then the agent's own title, then the scope label.
 */
export function resolveTerminalLabel(scope: TerminalScope, oscTitle?: string): string {
  return scope.renamedLabel ?? oscTitle ?? scope.scopeLabel;
}
