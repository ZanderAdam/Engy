import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcher, type FileChangeHandler } from './index.js';

vi.mock('chokidar', () => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  const mockWatcher = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
      return mockWatcher;
    }),
    close: vi.fn().mockResolvedValue(undefined),
    _emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    _reset: () => handlers.clear(),
  };

  return {
    watch: vi.fn(() => {
      mockWatcher._reset();
      return mockWatcher;
    }),
    _mockWatcher: mockWatcher,
  };
});

async function getMockWatcher() {
  const chokidar = await import('chokidar');
  return (chokidar as unknown as { _mockWatcher: ReturnType<typeof createMockWatcher> })
    ._mockWatcher;
}

type MockWatcher = {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _emit: (event: string, ...args: unknown[]) => void;
  _reset: () => void;
};

function createMockWatcher(): MockWatcher {
  throw new Error('Not used directly');
}

describe('FileWatcher', () => {
  let onChange: FileChangeHandler;
  let watcher: FileWatcher;

  beforeEach(async () => {
    vi.useFakeTimers();
    onChange = vi.fn();
    watcher = new FileWatcher(onChange);
    const mock = await getMockWatcher();
    mock.close.mockClear();
  });

  afterEach(async () => {
    await watcher.close();
    vi.useRealTimers();
  });

  it('starts watching workspace repos', async () => {
    const { watch } = await import('chokidar');

    await watcher.updateWorkspaces([{ slug: 'my-project', repos: ['/tmp/repo1'] }]);

    expect(watch).toHaveBeenCalledWith(['/tmp/repo1'], {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**'],
    });
  });

  it('fires debounced onChange for file changes', async () => {
    const mock = await getMockWatcher();

    await watcher.updateWorkspaces([{ slug: 'proj', repos: ['/tmp/r'] }]);

    mock._emit('change', '/tmp/r/src/file.ts');

    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith('proj', '/tmp/r/src/file.ts', 'change');
  });

  it('debounces rapid changes to the same file', async () => {
    const mock = await getMockWatcher();

    await watcher.updateWorkspaces([{ slug: 'proj', repos: ['/tmp/r'] }]);

    mock._emit('change', '/tmp/r/src/file.ts');
    vi.advanceTimersByTime(100);
    mock._emit('change', '/tmp/r/src/file.ts');
    vi.advanceTimersByTime(100);
    mock._emit('change', '/tmp/r/src/file.ts');
    vi.advanceTimersByTime(300);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('handles add and unlink events', async () => {
    const mock = await getMockWatcher();

    await watcher.updateWorkspaces([{ slug: 'proj', repos: ['/tmp/r'] }]);

    mock._emit('add', '/tmp/r/new-file.ts');
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith('proj', '/tmp/r/new-file.ts', 'add');

    mock._emit('unlink', '/tmp/r/deleted.ts');
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith('proj', '/tmp/r/deleted.ts', 'unlink');
  });

  it('removes watchers for workspaces no longer present', async () => {
    const mock = await getMockWatcher();

    await watcher.updateWorkspaces([{ slug: 'proj', repos: ['/tmp/r'] }]);
    expect(mock.close).not.toHaveBeenCalled();

    await watcher.updateWorkspaces([]);
    expect(mock.close).toHaveBeenCalled();
  });
});
