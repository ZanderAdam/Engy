import { describe, it, expect } from 'vitest';
import { registerPrimaryInjectTarget, isPrimaryReadyFor } from './terminal-inject-priority';

describe('terminal-inject-priority', () => {
  describe('isPrimaryReadyFor', () => {
    it('is false when no primary is registered', () => {
      expect(isPrimaryReadyFor(undefined)).toBe(false);
    });

    it('is true when a registered primary reports ready', () => {
      const unregister = registerPrimaryInjectTarget(null, () => true);
      try {
        expect(isPrimaryReadyFor(undefined)).toBe(true);
      } finally {
        unregister();
      }
    });

    it('is false when the only registered primary reports not ready', () => {
      const unregister = registerPrimaryInjectTarget(null, () => false);
      try {
        expect(isPrimaryReadyFor(undefined)).toBe(false);
      } finally {
        unregister();
      }
    });

    it('stops considering a primary once unregistered', () => {
      const unregister = registerPrimaryInjectTarget(null, () => true);
      unregister();
      expect(isPrimaryReadyFor(undefined)).toBe(false);
    });

    it('scopes by tabId the same way onInject filters events: a null event tabId is a broadcast', () => {
      const unregister = registerPrimaryInjectTarget('tab-a', () => true);
      try {
        expect(isPrimaryReadyFor(null)).toBe(true);
        expect(isPrimaryReadyFor(undefined)).toBe(true);
      } finally {
        unregister();
      }
    });

    it('does not match a primary registered under a different tabId', () => {
      const unregister = registerPrimaryInjectTarget('tab-a', () => true);
      try {
        expect(isPrimaryReadyFor('tab-b')).toBe(false);
      } finally {
        unregister();
      }
    });

    it('matches a primary registered under the same tabId', () => {
      const unregister = registerPrimaryInjectTarget('tab-a', () => true);
      try {
        expect(isPrimaryReadyFor('tab-a')).toBe(true);
      } finally {
        unregister();
      }
    });

    it('is ready if any of several registered primaries is ready', () => {
      const u1 = registerPrimaryInjectTarget(null, () => false);
      const u2 = registerPrimaryInjectTarget(null, () => true);
      try {
        expect(isPrimaryReadyFor(undefined)).toBe(true);
      } finally {
        u1();
        u2();
      }
    });
  });
});
