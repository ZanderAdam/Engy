import { describe, it, expect } from 'vitest';
import { deriveCheckState } from './pr-check-state';

describe('deriveCheckState', () => {
  it('should return passing for success conclusion', () => {
    expect(deriveCheckState('completed', 'success')).toBe('passing');
  });

  it('should return passing for skipped conclusion', () => {
    expect(deriveCheckState('completed', 'skipped')).toBe('passing');
  });

  it('should return passing for neutral conclusion', () => {
    expect(deriveCheckState('completed', 'neutral')).toBe('passing');
  });

  it('should return failing for failure conclusion', () => {
    expect(deriveCheckState('completed', 'failure')).toBe('failing');
  });

  it('should return failing for timed_out conclusion', () => {
    expect(deriveCheckState('completed', 'timed_out')).toBe('failing');
  });

  it('should return failing for cancelled conclusion', () => {
    expect(deriveCheckState('completed', 'cancelled')).toBe('failing');
  });

  it('should return failing for action_required conclusion', () => {
    expect(deriveCheckState('completed', 'action_required')).toBe('failing');
  });

  it('should return pending for in_progress CheckRun with null conclusion', () => {
    expect(deriveCheckState('in_progress', null)).toBe('pending');
  });

  it('should return pending for queued CheckRun with null conclusion', () => {
    expect(deriveCheckState('queued', null)).toBe('pending');
  });

  it('should return passing for StatusContext SUCCESS status', () => {
    expect(deriveCheckState('SUCCESS', null)).toBe('passing');
  });

  it('should return failing for StatusContext FAILURE status', () => {
    expect(deriveCheckState('FAILURE', null)).toBe('failing');
  });

  it('should return failing for StatusContext ERROR status', () => {
    expect(deriveCheckState('ERROR', null)).toBe('failing');
  });

  it('should return pending for StatusContext PENDING status', () => {
    expect(deriveCheckState('PENDING', null)).toBe('pending');
  });

  it('[FR-PRMON-010] should return failing for startup_failure conclusion', () => {
    expect(deriveCheckState('COMPLETED', 'STARTUP_FAILURE')).toBe('failing');
  });

  it.each(['WAITING', 'REQUESTED'])('[FR-PRMON-010] should return pending for %s status', (s) => {
    expect(deriveCheckState(s, null)).toBe('pending');
  });
});
