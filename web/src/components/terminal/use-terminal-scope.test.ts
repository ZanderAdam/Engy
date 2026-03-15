import { describe, it, expect } from 'vitest';
import { deriveScope } from './use-terminal-scope';
import { shellEscape } from '@/lib/shell';

describe('deriveScope', () => {
  describe('project scope', () => {
    it('should use projectDir as workingDir and add ALL repos as --add-dir', () => {
      const scope = deriveScope('my-ws', '/home/user/.engy/my-ws', ['/repo1', '/repo2'], 1, 'my-proj', 5);
      expect(scope.scopeType).toBe('project');
      expect(scope.workingDir).toBe('/home/user/.engy/my-ws/projects/my-proj');
      expect(scope.command).toContain("--add-dir '/repo1'");
      expect(scope.command).toContain("--add-dir '/repo2'");
      expect(scope.command).toContain('--permission-mode acceptEdits');
    });

    it('should pass context via --append-system-prompt, not as prompt arg', () => {
      const scope = deriveScope('my-ws', '/ws-dir', ['/repo1'], 1, 'proj', 5);
      expect(scope.command).toContain('--append-system-prompt');
      expect(scope.command).toContain(shellEscape('Workspace: my-ws (id: 1)'));
      expect(scope.command).toContain(shellEscape('Project: proj (id: 5)'));
      expect(scope.command).toContain(shellEscape('Repo: /repo1'));
      // Should NOT have a prompt arg (command starts with 'claude --add-dir' or 'claude --append')
      expect(scope.command).toMatch(/^claude\s+--/);
    });

    it('should handle no repos', () => {
      const scope = deriveScope('ws', '/ws-dir', [], 1, 'proj', 5);
      expect(scope.workingDir).toBe('/ws-dir/projects/proj');
      expect(scope.command).not.toContain('Repo:');
      expect(scope.command).not.toContain('Repos:');
    });

    it('should set scopeLabel with project slug', () => {
      const scope = deriveScope('ws', '/ws-dir', [], 1, 'my-proj', 5);
      expect(scope.scopeLabel).toBe('project: my-proj');
    });

    it('should set workspaceSlug', () => {
      const scope = deriveScope('my-ws', '/ws-dir', [], 1, 'my-proj', 5);
      expect(scope.workspaceSlug).toBe('my-ws');
    });
  });

  describe('workspace scope', () => {
    it('should use workspaceDir as workingDir and add ALL repos as --add-dir', () => {
      const scope = deriveScope('my-ws', '/home/user/.engy/my-ws', ['/repo1', '/repo2'], 1);
      expect(scope.scopeType).toBe('workspace');
      expect(scope.workingDir).toBe('/home/user/.engy/my-ws');
      expect(scope.command).toContain("--add-dir '/repo1'");
      expect(scope.command).toContain("--add-dir '/repo2'");
      expect(scope.command).toContain('--permission-mode acceptEdits');
    });

    it('should pass workspace context via --append-system-prompt without project fields', () => {
      const scope = deriveScope('my-ws', '/ws-dir', ['/repo1'], 2);
      expect(scope.command).toContain('--append-system-prompt');
      expect(scope.command).toContain(shellEscape('Workspace: my-ws (id: 2)'));
      expect(scope.command).not.toContain('Project:');
      expect(scope.command).not.toContain('Project dir:');
    });

    it('should handle no repos', () => {
      const scope = deriveScope('ws', '/ws-dir', [], 1);
      expect(scope.workingDir).toBe('/ws-dir');
      expect(scope.command).toContain('--permission-mode acceptEdits');
    });

    it('should set scopeLabel with workspace slug', () => {
      const scope = deriveScope('my-ws', '/ws-dir', [], 1);
      expect(scope.scopeLabel).toBe('my-ws');
    });

    it('should set workspaceSlug', () => {
      const scope = deriveScope('my-ws', '/ws-dir', [], 1);
      expect(scope.workspaceSlug).toBe('my-ws');
    });
  });
});
