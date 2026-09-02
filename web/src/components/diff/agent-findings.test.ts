import { describe, it, expect } from 'vitest';
import { findingSeverity, threadSource, SEVERITY_PRESENTATION } from './agent-findings';

describe('diff thread attribution', () => {
  describe('threadSource', () => {
    it('should read an agent-authored thread as agent', () => {
      expect(threadSource('agent')).toBe('agent');
    });

    it('should read an imported GitHub thread as github', () => {
      expect(threadSource('github')).toBe('github');
    });

    it("should treat a thread with no source as the user's own comment", () => {
      expect(threadSource(undefined)).toBe('local');
    });

    it("should treat an unrecognised source as the user's own comment", () => {
      expect(threadSource('gitlab')).toBe('local');
      expect(threadSource(42)).toBe('local');
      expect(threadSource(null)).toBe('local');
    });
  });

  describe('findingSeverity', () => {
    it('should accept every severity the review tools can write', () => {
      expect(findingSeverity('critical')).toBe('critical');
      expect(findingSeverity('high')).toBe('high');
      expect(findingSeverity('medium')).toBe('medium');
    });

    it('should leave a thread carrying no severity unbadged', () => {
      expect(findingSeverity(undefined)).toBeUndefined();
      expect(findingSeverity('urgent')).toBeUndefined();
      expect(findingSeverity(1)).toBeUndefined();
    });
  });

  describe('SEVERITY_PRESENTATION', () => {
    it('should give every severity a distinct label and colour', () => {
      const entries = Object.values(SEVERITY_PRESENTATION);
      expect(new Set(entries.map((e) => e.label)).size).toBe(entries.length);
      expect(new Set(entries.map((e) => e.className)).size).toBe(entries.length);
    });
  });
});
