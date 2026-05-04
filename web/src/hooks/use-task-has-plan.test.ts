import { describe, it, expect } from 'vitest';
import { buildTaskSlug } from './use-task-has-plan';

describe('buildTaskSlug', () => {
  it('joins workspace slug and task id', () => {
    expect(buildTaskSlug('engy', 42)).toBe('engy-T42');
  });

  it('returns empty string when workspace slug is empty', () => {
    expect(buildTaskSlug('', 42)).toBe('');
  });
});
