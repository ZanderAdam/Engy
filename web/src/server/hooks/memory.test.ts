import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildMemoryCaptureCommand,
  MEMORY_CAPTURE_HOOK_EVENT,
  MEMORY_CAPTURE_ORIGIN_TAG,
  MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES,
} from './memory';

describe('buildMemoryCaptureCommand', () => {
  const hookUrl = 'http://localhost:3123/hooks/session-1';

  it('[FR-MEMORY-300] should detach via nohup and disown so the parent never waits on the distillation', () => {
    const command = buildMemoryCaptureCommand(hookUrl);
    expect(command).toContain('nohup');
    expect(command).toContain('disown');
    // Explicitly nested under bash -c: disown is a bash builtin, not POSIX sh.
    expect(command).toContain('bash -c');
  });

  it('should read the hook payload from stdin rather than an argument', () => {
    expect(buildMemoryCaptureCommand(hookUrl)).toContain('PAYLOAD="$(cat)"');
  });

  it('should grant the nested job no MCP access at all', () => {
    const command = buildMemoryCaptureCommand(hookUrl);
    expect(command).not.toContain('--mcp-config');
    expect(command).not.toContain('--strict-mcp-config');
    expect(command).not.toContain('createFleetingMemory');
    expect(command).not.toContain('listWorkspaces');
  });

  it('[FR-MEMORY-310] should not rely on the nested job to add the origin tag — the server force-sets it', () => {
    // The tag constant is still exported (the server-side handler uses it),
    // but it must not appear inside the prompt/command text itself.
    expect(buildMemoryCaptureCommand(hookUrl)).not.toContain(MEMORY_CAPTURE_ORIGIN_TAG);
  });

  it('should cap the transcript via tail rather than passing it whole', () => {
    const command = buildMemoryCaptureCommand(hookUrl);
    expect(command).toContain(`tail -c ${MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES}`);
  });

  it('should POST the distillation back to the given hook endpoint', () => {
    const command = buildMemoryCaptureCommand(hookUrl);
    expect(command).toContain('curl');
    expect(command).toContain(`'${hookUrl}'`);
    expect(command).toContain(MEMORY_CAPTURE_HOOK_EVENT);
  });

  it('should reuse the engy:session-distill extraction criteria rather than a new standard', () => {
    expect(buildMemoryCaptureCommand(hookUrl)).toContain('engy:session-distill');
  });
});

describe('memory capture command — end-to-end shell execution', () => {
  let workDir: string;
  let binDir: string;
  let argvFile: string;
  let transcriptPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'engy-memory-capture-'));
    binDir = path.join(workDir, 'bin');
    mkdirSync(binDir);
    argvFile = path.join(workDir, 'claude-argv.txt');
    transcriptPath = path.join(workDir, 'transcript.jsonl');

    // Stub `claude` that records its argv and exits with no stdout — proves the
    // generated shell correctly launches and quotes the nested invocation
    // without actually spending a real model call.
    const stub = [
      '#!/bin/sh',
      `: > "${argvFile}"`,
      'for a in "$@"; do',
      `  printf 'ARG:[%s]\\n' "$a" >> "${argvFile}"`,
      'done',
      // Sentinel: the reader waits for this rather than for a non-empty file,
      // which under load can be read mid-append and miss later args.
      `printf 'ARGV_COMPLETE\\n' >> "${argvFile}"`,
      // Delays the script's own "rm -f $CAPPED" cleanup so a test can read
      // the capped transcript file before it disappears.
      'sleep 0.5',
      'exit 0',
      '',
    ].join('\n');
    writeFileSync(path.join(binDir, 'claude'), stub);
    chmodSync(path.join(binDir, 'claude'), 0o755);

    env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function runHook(payload: Record<string, unknown>): string {
    const command = buildMemoryCaptureCommand('http://localhost:3123/hooks/session-1');
    return execFileSync('sh', ['-c', command], {
      input: JSON.stringify(payload),
      env,
      encoding: 'utf8',
    });
  }

  async function waitForArgv(): Promise<string> {
    // The claude launch is detached (nohup ... & disown); give the
    // background job a moment to run before checking what it received.
    for (let i = 0; i < 100; i++) {
      try {
        const content = readFileSync(argvFile, 'utf8');
        if (content.includes('ARGV_COMPLETE')) return content;
      } catch {
        // not written yet
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('nested claude never finished writing its argv');
  }

  it('[FR-MEMORY-300] should return {} immediately and launch the nested claude for PreCompact', async () => {
    writeFileSync(transcriptPath, '{"line":1}\n{"line":2}\n');
    const out = runHook({
      session_id: 's1',
      transcript_path: transcriptPath,
      cwd: '/some/repo',
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      custom_instructions: null,
    });
    expect(out).toBe('{}');

    const argv = await waitForArgv();
    expect(argv).toContain('ARG:[-p]');
    expect(argv).toContain('PreCompact');
    expect(argv).toContain('--disallowedTools');
    // The transcript is untrusted input and nothing supervises this run, so the
    // shell, network, and MCP surface must all stay unreachable to it.
    expect(argv).not.toContain('--dangerously-skip-permissions');
    expect(argv).not.toContain('--mcp-config');
    expect(argv).not.toContain('--strict-mcp-config');
    for (const tool of ['Bash', 'Edit', 'Write', 'WebFetch', 'Glob', 'Grep', 'TodoWrite']) {
      expect(argv).toContain(tool);
    }
  });

  it('[FR-MEMORY-300] should skip the nested claude for SessionEnd reason=clear', async () => {
    writeFileSync(transcriptPath, '{"line":1}\n');
    const out = runHook({
      session_id: 's1',
      transcript_path: transcriptPath,
      cwd: '/some/repo',
      hook_event_name: 'SessionEnd',
      reason: 'clear',
    });
    expect(out).toBe('{}');

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => readFileSync(argvFile, 'utf8')).toThrow();
  });

  it('[FR-MEMORY-300] should capture for SessionEnd reasons other than clear', async () => {
    writeFileSync(transcriptPath, '{"line":1}\n');
    const out = runHook({
      session_id: 's1',
      transcript_path: transcriptPath,
      cwd: '/some/repo',
      hook_event_name: 'SessionEnd',
      reason: 'other',
    });
    expect(out).toBe('{}');

    const argv = await waitForArgv();
    expect(argv).toContain('SessionEnd');
  });

  it('[FR-MEMORY-300] should return {} and not launch anything when transcript_path is missing', async () => {
    const out = runHook({
      session_id: 's1',
      hook_event_name: 'PreCompact',
    });
    expect(out).toBe('{}');

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => readFileSync(argvFile, 'utf8')).toThrow();
  });

  it('[FR-MEMORY-300] should return {} and not launch anything when the transcript file does not exist', async () => {
    const out = runHook({
      session_id: 's1',
      transcript_path: path.join(workDir, 'does-not-exist.jsonl'),
      hook_event_name: 'PreCompact',
    });
    expect(out).toBe('{}');

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => readFileSync(argvFile, 'utf8')).toThrow();
  });

  it('should feed the nested claude only the tail of an oversized transcript', async () => {
    const head = 'HEAD_MARKER_'.repeat(6000); // well over the cap
    const tail = 'TAIL_MARKER_END';
    writeFileSync(transcriptPath, head + tail);
    expect(head.length + tail.length).toBeGreaterThan(MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES);

    runHook({
      session_id: 's1',
      transcript_path: transcriptPath,
      cwd: '/some/repo',
      hook_event_name: 'PreCompact',
    });

    const argv = await waitForArgv();
    const promptLine = argv.split('\n').find((l) => l.includes('transcript tail at'));
    expect(promptLine).toBeDefined();
    const match = (promptLine as string).match(/transcript tail at (\S+) --/);
    expect(match).not.toBeNull();
    const cappedPath = (match as RegExpMatchArray)[1];

    const full = head + tail;
    const capped = readFileSync(cappedPath, 'utf8');
    expect(capped.length).toBe(MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES);
    expect(capped.endsWith(tail)).toBe(true);
    expect(capped).toBe(full.slice(full.length - MEMORY_CAPTURE_TRANSCRIPT_TAIL_BYTES));
    expect(capped.startsWith(head.slice(0, 10))).toBe(false); // the file's start was dropped
  });
});

describe('memory capture command — distillation POST to the hook endpoint', () => {
  let workDir: string;
  let binDir: string;
  let transcriptPath: string;
  let curlArgvFile: string;
  let curlBodyFile: string;
  let env: NodeJS.ProcessEnv;

  function writeClaudeStub(stdout: string): void {
    const stub = ['#!/bin/sh', `printf '%s' '${stdout.replace(/'/g, "'\\''")}'`, ''].join('\n');
    writeFileSync(path.join(binDir, 'claude'), stub);
    chmodSync(path.join(binDir, 'claude'), 0o755);
  }

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'engy-memory-capture-post-'));
    binDir = path.join(workDir, 'bin');
    mkdirSync(binDir);
    transcriptPath = path.join(workDir, 'transcript.jsonl');
    curlArgvFile = path.join(workDir, 'curl-argv.txt');
    curlBodyFile = path.join(workDir, 'curl-body.txt');
    writeFileSync(transcriptPath, '{"line":1}\n');

    // Stub `curl` that records its argv and the stdin body it was piped
    // (`-d @-`), standing in for the real POST to `/hooks/<sessionId>`.
    const curlStub = [
      '#!/bin/sh',
      `: > "${curlArgvFile}"`,
      'for a in "$@"; do',
      `  printf 'ARG:[%s]\\n' "$a" >> "${curlArgvFile}"`,
      'done',
      `cat > "${curlBodyFile}"`,
      'exit 0',
      '',
    ].join('\n');
    writeFileSync(path.join(binDir, 'curl'), curlStub);
    chmodSync(path.join(binDir, 'curl'), 0o755);

    env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function runHook(payload: Record<string, unknown>): string {
    const command = buildMemoryCaptureCommand('http://localhost:3123/hooks/session-1');
    return execFileSync('sh', ['-c', command], {
      input: JSON.stringify(payload),
      env,
      encoding: 'utf8',
    });
  }

  // Waits for non-empty content, not just existence: the stub's shell
  // redirection can create the file before the piped body finishes writing.
  async function waitForFile(file: string): Promise<string> {
    for (let i = 0; i < 60; i++) {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf8');
        if (content) return content;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  it('[FR-MEMORY-300] should POST the nested job stdout, unmodified, as a JSON-encoded distillation field', async () => {
    writeClaudeStub('{"memories":[{"content":"Core claim: x","type":"capture","tags":["t1"]}]}');

    const out = runHook({
      session_id: 's1',
      transcript_path: transcriptPath,
      hook_event_name: 'PreCompact',
    });
    expect(out).toBe('{}');

    const argv = await waitForFile(curlArgvFile);
    expect(argv).toContain('ARG:[POST]');
    expect(argv).toContain('ARG:[http://localhost:3123/hooks/session-1]');

    const body = await waitForFile(curlBodyFile);
    const envelope = JSON.parse(body) as { hook_event_name: string; distillation: string };
    expect(envelope.hook_event_name).toBe(MEMORY_CAPTURE_HOOK_EVENT);
    const distilled = JSON.parse(envelope.distillation) as { memories: Array<{ content: string }> };
    expect(distilled.memories).toHaveLength(1);
    expect(distilled.memories[0].content).toBe('Core claim: x');
  });

  it('should not POST anything when the nested job prints no output', async () => {
    writeClaudeStub('');

    const out = runHook({
      session_id: 's1',
      transcript_path: transcriptPath,
      hook_event_name: 'PreCompact',
    });
    expect(out).toBe('{}');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(existsSync(curlArgvFile)).toBe(false);
  });
});
