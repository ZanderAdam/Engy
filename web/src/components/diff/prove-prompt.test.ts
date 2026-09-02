import { describe, it, expect } from 'vitest';
import { buildProvePrompt } from './prove-prompt';

function makeInput(overrides: Partial<Parameters<typeof buildProvePrompt>[0]> = {}) {
  return {
    threadId: 'thread-42',
    filePath: 'src/server/auth.ts',
    lineNumber: 88,
    findingBody: 'Expired tokens are accepted.\n\nFails when: a token past exp is replayed.',
    ...overrides,
  };
}

describe('prove prompt', () => {
  describe('buildProvePrompt', () => {
    it('should name the file and line the finding is anchored to', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('src/server/auth.ts:88');
    });

    it('should include the thread id', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('thread-42');
    });

    it('should include the finding body verbatim', () => {
      const findingBody = 'Expired tokens are accepted.\n\nFails when: a token past exp is replayed.';
      const prompt = buildProvePrompt(makeInput({ findingBody }));

      expect(prompt).toContain(findingBody);
    });

    it('should ask the agent to climb to rung 4 of the evidence ladder', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('rung 4');
      expect(prompt).toMatch(/failing test|repro command/);
    });

    it('should ask for all three verdicts', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('VERIFIED');
      expect(prompt).toContain('NOT VERIFIED');
      expect(prompt).toContain('INCONCLUSIVE');
    });

    it('should point the agent at diff_review_list rather than an invented reply tool', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('diff_review_list');
    });
  });
});
