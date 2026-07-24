import { describe, it, expect } from 'vitest';
import {
  SEARCH_MODES,
  activeQueryForMode,
  isLiveMode,
  needsManualSubmit,
  searchModeMeta,
} from './search-mode';

describe('search-mode', () => {
  describe('mode metadata', () => {
    it('[FR-SEARCH-015] should expose lex, vector, and hybrid modes', () => {
      expect(SEARCH_MODES.map((m) => m.mode)).toEqual(['lex', 'vector', 'hybrid']);
    });

    it('[FR-SEARCH-015] should mark lex and vector as live and hybrid as manual', () => {
      expect(isLiveMode('lex')).toBe(true);
      expect(isLiveMode('vector')).toBe(true);
      expect(isLiveMode('hybrid')).toBe(false);
    });

    it('should fall back to the first mode for an unknown value', () => {
      expect(searchModeMeta('bogus' as never).mode).toBe('lex');
    });
  });

  describe('activeQueryForMode', () => {
    it('[FR-SEARCH-015] should use the debounced query for live modes', () => {
      expect(activeQueryForMode('lex', 'debounced', 'submitted')).toBe('debounced');
      expect(activeQueryForMode('vector', 'debounced', 'submitted')).toBe('debounced');
    });

    it('[FR-SEARCH-015] should use the submitted query for hybrid mode', () => {
      expect(activeQueryForMode('hybrid', 'debounced', 'submitted')).toBe('submitted');
    });

    it('[FR-SEARCH-015] should yield an empty query for hybrid until something is submitted', () => {
      expect(activeQueryForMode('hybrid', 'typing', '')).toBe('');
    });

    it('[FR-SEARCH-015] should ignore a stale submitted value in live modes when the debounced query is empty', () => {
      expect(activeQueryForMode('lex', '', 'stale')).toBe('');
      expect(activeQueryForMode('vector', '', 'stale')).toBe('');
    });
  });

  describe('needsManualSubmit', () => {
    it('[FR-SEARCH-015] should never require a manual submit for live modes', () => {
      expect(needsManualSubmit('lex', 'anything', '')).toBe(false);
      expect(needsManualSubmit('vector', 'anything', '')).toBe(false);
    });

    it('[FR-SEARCH-015] should never require a manual submit for live modes even with a stale submitted value', () => {
      expect(needsManualSubmit('lex', 'typed', 'stale')).toBe(false);
      expect(needsManualSubmit('vector', 'typed', 'stale')).toBe(false);
    });

    it('[FR-SEARCH-015] should require a submit when hybrid input is non-empty and unsubmitted', () => {
      expect(needsManualSubmit('hybrid', 'query', '')).toBe(true);
    });

    it('[FR-SEARCH-015] should not require a submit when hybrid input matches the submitted value', () => {
      expect(needsManualSubmit('hybrid', 'query', 'query')).toBe(false);
    });

    it('[FR-SEARCH-015] should require a submit again when hybrid input is edited after submitting', () => {
      expect(needsManualSubmit('hybrid', 'query more', 'query')).toBe(true);
    });

    it('should ignore surrounding whitespace when comparing input to the submitted value', () => {
      expect(needsManualSubmit('hybrid', '  query  ', 'query')).toBe(false);
    });

    it('should not require a submit for empty hybrid input', () => {
      expect(needsManualSubmit('hybrid', '   ', '')).toBe(false);
    });
  });
});
