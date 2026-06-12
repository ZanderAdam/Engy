import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach, vi } from 'vitest';

// Isolate the acquirePidFile logic by extracting it for testability.
// The function in index.ts exits the process on failure. We replicate the
// logic here with a configurable process.exit so tests can assert on it
// without actually exiting.

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePidFile(
  pidFile: string,
  currentPid: number,
  onConflict: () => never,
): void {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });

  try {
    fs.writeFileSync(pidFile, String(currentPid), { flag: 'wx' });
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  let existingPid: number | null = null;
  try {
    const content = fs.readFileSync(pidFile, 'utf-8').trim();
    const parsed = parseInt(content, 10);
    if (!isNaN(parsed)) existingPid = parsed;
  } catch {
    // Unreadable — treat as stale.
  }

  if (existingPid !== null && existingPid !== currentPid && isProcessRunning(existingPid)) {
    onConflict();
  }

  try {
    fs.unlinkSync(pidFile);
  } catch {
    // May have been removed already.
  }

  try {
    fs.writeFileSync(pidFile, String(currentPid), { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      onConflict();
    }
    throw err;
  }
}

describe('acquirePidFile', () => {
  let tmpDir: string;
  let pidFile: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-pid-test-'));
    pidFile = path.join(tmpDir, 'daemon.pid');
  }

  describe('no existing pidfile', () => {
    it('should create the pidfile with the current pid', () => {
      setup();
      const onConflict = vi.fn() as unknown as () => never;

      acquirePidFile(pidFile, process.pid, onConflict);

      const written = fs.readFileSync(pidFile, 'utf-8').trim();
      expect(written).toBe(String(process.pid));
      expect(onConflict).not.toHaveBeenCalled();
    });
  });

  describe('stale pidfile (dead process)', () => {
    it('should overwrite a pidfile whose process is no longer running', () => {
      setup();
      // Write a pid that is almost certainly dead (pid 1 is init/systemd, never
      // starts a test daemon; use a high number that is free on any system).
      const deadPid = 999_999_999;
      fs.writeFileSync(pidFile, String(deadPid));
      const onConflict = vi.fn() as unknown as () => never;

      acquirePidFile(pidFile, process.pid, onConflict);

      const written = fs.readFileSync(pidFile, 'utf-8').trim();
      expect(written).toBe(String(process.pid));
      expect(onConflict).not.toHaveBeenCalled();
    });

    it('should succeed when the pidfile is unreadable / corrupt', () => {
      setup();
      fs.writeFileSync(pidFile, 'not-a-number');
      const onConflict = vi.fn() as unknown as () => never;

      acquirePidFile(pidFile, process.pid, onConflict);

      const written = fs.readFileSync(pidFile, 'utf-8').trim();
      expect(written).toBe(String(process.pid));
      expect(onConflict).not.toHaveBeenCalled();
    });
  });

  describe('live pidfile (another daemon running)', () => {
    it('should call onConflict when a live process owns the pidfile', () => {
      setup();
      // The current process is definitely alive — use it as the "other daemon".
      // We need a pid != process.pid that is alive. Use the parent process.
      const alivePid = process.ppid;
      fs.writeFileSync(pidFile, String(alivePid));
      const onConflict = vi.fn(() => { throw new Error('conflict'); }) as unknown as () => never;

      expect(() => acquirePidFile(pidFile, process.pid, onConflict)).toThrow('conflict');
      expect(onConflict).toHaveBeenCalled();
    });
  });
});
