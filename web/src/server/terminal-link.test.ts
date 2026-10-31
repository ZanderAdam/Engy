import { describe, it, expect, afterEach } from 'vitest';
import { deriveMcpOrigin, terminalLink } from './terminal-link';

describe('terminal link', () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  describe('deriveMcpOrigin', () => {
    it('should reuse the origin of the MCP URL in the caller command', () => {
      const command = `claude --mcp-config '{"url":"https://engy.example.com:8443/mcp/abc"}'`;
      expect(deriveMcpOrigin(command)).toBe('https://engy.example.com:8443');
    });

    it('should fall back to the local port when the command has no MCP URL', () => {
      process.env.PORT = '4123';
      expect(deriveMcpOrigin('bash')).toBe('http://localhost:4123');
      expect(deriveMcpOrigin(undefined)).toBe('http://localhost:4123');
    });
  });

  describe('terminalLink', () => {
    it('should build an absolute short link from the session id', () => {
      expect(terminalLink('http://localhost:3000', 'sess-1')).toBe(
        'http://localhost:3000/t/sess-1',
      );
    });
  });
});
