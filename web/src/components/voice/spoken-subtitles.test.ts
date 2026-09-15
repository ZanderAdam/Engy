import { describe, it, expect } from 'vitest';
import { dismissSpoken, readSpoken, recordSpoken } from './spoken-subtitles';

describe('spoken subtitles', () => {
  it('[FR-TG2.32] should keep the last reply each session spoke', () => {
    recordSpoken('build', 'Tests are running.');
    recordSpoken('build', 'Tests are green.');
    recordSpoken('docs', 'The docs are up to date.');

    expect(readSpoken('build')).toBe('Tests are green.');
    expect(readSpoken('docs')).toBe('The docs are up to date.');
  });

  it('[FR-TG2.32] should clear a reply once it is dismissed', () => {
    recordSpoken('dismissed', 'Done.');

    dismissSpoken('dismissed');

    expect(readSpoken('dismissed')).toBeNull();
  });

  it('should have nothing for a session that never spoke', () => {
    expect(readSpoken('silent')).toBeNull();
  });
});
