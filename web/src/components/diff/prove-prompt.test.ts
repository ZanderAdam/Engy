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

    it('should demand a run artifact rather than an argument', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('failing test');
      expect(prompt).toMatch(/run the code/i);
      expect(prompt).toMatch(/failing test|repro command/);
    });

    it('should ask for all three verdicts', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('VERIFIED');
      expect(prompt).toContain('NOT VERIFIED');
      expect(prompt).toContain('INCONCLUSIVE');
    });

    it('should not lean on Engy vocabulary the receiving agent never loaded', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).not.toMatch(/rung/i);
      expect(prompt).not.toMatch(/evidence ladder/i);
    });

    it('should point the agent at diff_review_list for the thread current text', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('diff_review_list');
    });

    it('should send the verdict back into the thread, not just the terminal', () => {
      const prompt = buildProvePrompt(makeInput());

      expect(prompt).toContain('replyToComment');
    });
  });
});
