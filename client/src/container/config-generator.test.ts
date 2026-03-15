import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  devcontainerJsonContent,
  dockerfileContent,
  firewallScriptContent,
  generateDevcontainerConfig,
  rewriteLocalhostUrls,
  type ConfigGeneratorOptions,
} from './config-generator.js';

describe('config-generator', () => {
  let tempDir: string;

  async function createTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'engy-devcontainer-test-'));
  }

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('rewriteLocalhostUrls', () => {
    it('should rewrite http://localhost URLs to host.docker.internal', () => {
      const result = rewriteLocalhostUrls({
        SERVER_URL: 'http://localhost:3000',
      });

      expect(result.SERVER_URL).toBe('http://host.docker.internal:3000');
    });

    it('should rewrite https://localhost URLs to host.docker.internal', () => {
      const result = rewriteLocalhostUrls({
        API_URL: 'https://localhost:8080/api',
      });

      expect(result.API_URL).toBe('https://host.docker.internal:8080/api');
    });

    it('should pass through non-URL values unchanged', () => {
      const result = rewriteLocalhostUrls({
        NODE_ENV: 'development',
        DEBUG: 'true',
        REMOTE_URL: 'http://example.com:3000',
      });

      expect(result.NODE_ENV).toBe('development');
      expect(result.DEBUG).toBe('true');
      expect(result.REMOTE_URL).toBe('http://example.com:3000');
    });

    it('should handle empty env vars object', () => {
      const result = rewriteLocalhostUrls({});

      expect(result).toEqual({});
    });
  });

  describe('devcontainerJsonContent', () => {
    it('should use ${localWorkspaceFolder} for workspaceMount and workspaceFolder', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/projects/my-project',
        repos: ['/home/user/repos/repo1'],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;

      expect(json.workspaceMount).toBe(
        'source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind',
      );
      expect(json.workspaceFolder).toBe('${localWorkspaceFolder}');
    });

    it('should create bind mounts for repos at their original paths', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: ['/home/user/repos/repo1', '/home/user/repos/repo2'],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;
      const mounts = json.mounts as string[];

      expect(mounts).toContain('source=/home/user/repos/repo1,target=/home/user/repos/repo1,type=bind');
      expect(mounts).toContain('source=/home/user/repos/repo2,target=/home/user/repos/repo2,type=bind');
    });

    it('should include ~/.claude bind mount', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: [],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;
      const mounts = json.mounts as string[];

      expect(mounts).toContain(
        'source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind',
      );
    });

    it('should skip repos that are subdirectories of docsDir', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: ['/home/user/docs/sub-repo', '/home/user/repos/external'],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;
      const mounts = json.mounts as string[];

      expect(mounts).not.toContain(
        'source=/home/user/docs/sub-repo,target=/home/user/docs/sub-repo,type=bind',
      );
      expect(mounts).toContain(
        'source=/home/user/repos/external,target=/home/user/repos/external,type=bind',
      );
    });

    it('should skip duplicate repo paths', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: ['/home/user/repos/repo1', '/home/user/repos/repo1'],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;
      const mounts = json.mounts as string[];

      const repoMounts = mounts.filter((m) => m.includes('repo1'));
      expect(repoMounts).toHaveLength(1);
    });

    it('should not include vscode customizations', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: [],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;

      expect(json).not.toHaveProperty('customizations');
    });

    it('should include required runArgs for firewall', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: [],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;

      expect(json.runArgs).toEqual(['--cap-add=NET_ADMIN', '--cap-add=NET_RAW']);
    });

    it('should merge default and user env vars with localhost rewriting', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: [],
        containerConfig: {
          envVars: {
            ENGY_SERVER_URL: 'http://localhost:3000',
            CUSTOM_VAR: 'value',
          },
        },
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;
      const env = json.containerEnv as Record<string, string>;

      expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096');
      expect(env.DEVCONTAINER).toBe('true');
      expect(env.ENGY_SERVER_URL).toBe('http://host.docker.internal:3000');
      expect(env.CUSTOM_VAR).toBe('value');
    });

    it('should set remoteUser to node', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: [],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;

      expect(json.remoteUser).toBe('node');
    });

    it('should include postStartCommand and waitFor', () => {
      const options: ConfigGeneratorOptions = {
        docsDir: '/home/user/docs',
        repos: [],
      };

      const json = devcontainerJsonContent(options) as Record<string, unknown>;

      expect(json.postStartCommand).toBe('sudo /usr/local/bin/init-firewall.sh');
      expect(json.waitFor).toBe('postStartCommand');
    });
  });

  describe('dockerfileContent', () => {
    it('should include base packages', () => {
      const content = dockerfileContent();

      expect(content).toContain('FROM node:20');
      expect(content).toContain('git');
      expect(content).toContain('iptables');
      expect(content).toContain('ipset');
      expect(content).toContain('apt-get clean');
    });

    it('should include extra packages when provided', () => {
      const content = dockerfileContent(['python3', 'ripgrep']);

      expect(content).toContain('python3');
      expect(content).toContain('ripgrep');
      expect(content).toContain('git');
    });

    it('should include Claude Code installation', () => {
      const content = dockerfileContent();

      expect(content).toContain('npm install -g @anthropic-ai/claude-code');
    });

    it('should include firewall script setup', () => {
      const content = dockerfileContent();

      expect(content).toContain('COPY init-firewall.sh /usr/local/bin/');
      expect(content).toContain('chmod +x /usr/local/bin/init-firewall.sh');
    });
  });

  describe('firewallScriptContent', () => {
    it('should include default allowed domains', () => {
      const content = firewallScriptContent();

      expect(content).toContain('registry.npmjs.org');
      expect(content).toContain('api.anthropic.com');
      expect(content).toContain('sentry.io');
      expect(content).toContain('statsig.anthropic.com');
    });

    it('should include custom domains alongside defaults', () => {
      const content = firewallScriptContent(['custom.example.com', 'api.myservice.io']);

      expect(content).toContain('registry.npmjs.org');
      expect(content).toContain('custom.example.com');
      expect(content).toContain('api.myservice.io');
    });

    it('should include iptables firewall setup', () => {
      const content = firewallScriptContent();

      expect(content).toContain('#!/bin/bash');
      expect(content).toContain('set -euo pipefail');
      expect(content).toContain('ipset create allowed-domains hash:net');
      expect(content).toContain('iptables -P OUTPUT DROP');
    });

    it('should include firewall verification', () => {
      const content = firewallScriptContent();

      expect(content).toContain('Firewall verification passed');
      expect(content).toContain('example.com');
      expect(content).toContain('api.github.com');
    });
  });

  describe('generateDevcontainerConfig', () => {
    it('should create .devcontainer directory with all files', async () => {
      tempDir = await createTempDir();

      await generateDevcontainerConfig({
        docsDir: tempDir,
        repos: ['/some/repo'],
      });

      const devcontainerDir = join(tempDir, '.devcontainer');
      await expect(access(devcontainerDir)).resolves.toBeUndefined();

      const jsonContent = await readFile(join(devcontainerDir, 'devcontainer.json'), 'utf-8');
      const parsed = JSON.parse(jsonContent);
      expect(parsed.name).toBe('Engy Sandbox');
      expect(parsed.workspaceFolder).toBe('${localWorkspaceFolder}');

      const dockerfile = await readFile(join(devcontainerDir, 'Dockerfile'), 'utf-8');
      expect(dockerfile).toContain('FROM node:20');

      const firewall = await readFile(join(devcontainerDir, 'init-firewall.sh'), 'utf-8');
      expect(firewall).toContain('#!/bin/bash');
    });

    it('should skip generation if .devcontainer already exists', async () => {
      tempDir = await createTempDir();
      const devcontainerDir = join(tempDir, '.devcontainer');
      await mkdir(devcontainerDir);

      await generateDevcontainerConfig({
        docsDir: tempDir,
        repos: [],
      });

      // Verify no files were created since directory already existed
      await expect(access(join(devcontainerDir, 'devcontainer.json'))).rejects.toThrow();
    });

    it('should pass extraPackages and allowedDomains to generated files', async () => {
      tempDir = await createTempDir();

      await generateDevcontainerConfig({
        docsDir: tempDir,
        repos: [],
        containerConfig: {
          extraPackages: ['python3'],
          allowedDomains: ['custom.example.com'],
        },
      });

      const devcontainerDir = join(tempDir, '.devcontainer');

      const dockerfile = await readFile(join(devcontainerDir, 'Dockerfile'), 'utf-8');
      expect(dockerfile).toContain('python3');

      const firewall = await readFile(join(devcontainerDir, 'init-firewall.sh'), 'utf-8');
      expect(firewall).toContain('custom.example.com');
    });
  });
});
