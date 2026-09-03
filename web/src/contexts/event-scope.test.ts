import { describe, it, expect } from 'vitest';
import { isEventForWorkspace } from './event-scope';

describe('isEventForWorkspace', () => {
  // The bug this exists for: an agent's spoken answer broadcast to every
  // open socket played in workspaces the user was not talking to.
  it('[FR-TG2.24] should reject an event addressed to another workspace', () => {
    expect(isEventForWorkspace({ text: 'hi', workspaceSlug: 'other' }, 'mine')).toBe(false);
  });

  it('[FR-TG2.24] should accept an event addressed to this workspace', () => {
    expect(isEventForWorkspace({ text: 'hi', workspaceSlug: 'mine' }, 'mine')).toBe(true);
  });

  // Scoping is keyed on the field, not on a list of event types, so events
  // that are genuinely global keep flowing without being enumerated here.
  it('should accept an event that carries no workspace', () => {
    expect(isEventForWorkspace({ action: 'created', taskId: 1 }, 'mine')).toBe(true);
  });

  it.each([[null], [undefined], ['a string'], [42]])(
    'should accept a payload that is not an object (%s)',
    (payload) => {
      expect(isEventForWorkspace(payload, 'mine')).toBe(true);
    },
  );

  // A non-string slug is malformed, not a match — but dropping the event
  // would hide a server bug, so it is let through rather than swallowed.
  it('should accept a payload whose workspaceSlug is not a string', () => {
    expect(isEventForWorkspace({ workspaceSlug: 7 }, 'mine')).toBe(true);
  });
});
