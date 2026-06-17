import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('modern Clipboard API', () => {
    it('should use navigator.clipboard.writeText when available', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      const result = await copyToClipboard('hello');

      expect(writeText).toHaveBeenCalledWith('hello');
      expect(result).toBe(true);
    });
  });

  describe('legacy execCommand fallback', () => {
    it('should fall back to execCommand when navigator.clipboard is undefined', async () => {
      vi.stubGlobal('navigator', {});
      const execCommand = vi.fn().mockReturnValue(true);
      const textarea = makeTextareaStub();
      vi.stubGlobal('document', makeDocumentStub(textarea, execCommand));

      const result = await copyToClipboard('fallback text');

      expect(textarea.value).toBe('fallback text');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(result).toBe(true);
    });

    it('should fall back to execCommand when writeText rejects (insecure context)', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('not allowed'));
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const execCommand = vi.fn().mockReturnValue(true);
      vi.stubGlobal('document', makeDocumentStub(makeTextareaStub(), execCommand));

      const result = await copyToClipboard('text');

      expect(writeText).toHaveBeenCalled();
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(result).toBe(true);
    });
  });

  describe('failure handling', () => {
    it('should return false when execCommand reports failure', async () => {
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('document', makeDocumentStub(makeTextareaStub(), vi.fn().mockReturnValue(false)));

      expect(await copyToClipboard('text')).toBe(false);
    });

    it('should return false and not throw when execCommand throws', async () => {
      vi.stubGlobal('navigator', {});
      const execCommand = vi.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      vi.stubGlobal('document', makeDocumentStub(makeTextareaStub(), execCommand));

      expect(await copyToClipboard('text')).toBe(false);
    });
  });
});

function makeTextareaStub() {
  return {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
  };
}

function makeDocumentStub(
  textarea: ReturnType<typeof makeTextareaStub>,
  execCommand: ReturnType<typeof vi.fn>,
) {
  return {
    createElement: vi.fn().mockReturnValue(textarea),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand,
  };
}
