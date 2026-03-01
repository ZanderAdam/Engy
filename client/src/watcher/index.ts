import { watch, type FSWatcher } from 'chokidar';

const DEBOUNCE_MS = 300;

interface WatchedWorkspace {
  slug: string;
  repos: string[];
}

export type FileChangeHandler = (
  workspaceSlug: string,
  filePath: string,
  eventType: 'add' | 'change' | 'unlink',
) => void;

export class FileWatcher {
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onChange: FileChangeHandler;

  constructor(onChange: FileChangeHandler) {
    this.onChange = onChange;
  }

  async updateWorkspaces(workspaces: WatchedWorkspace[]): Promise<void> {
    const desiredSlugs = new Set(workspaces.map((w) => w.slug));

    for (const [slug, watcher] of this.watchers) {
      if (!desiredSlugs.has(slug)) {
        await watcher.close();
        this.watchers.delete(slug);
      }
    }

    for (const workspace of workspaces) {
      if (this.watchers.has(workspace.slug)) {
        const existing = this.watchers.get(workspace.slug)!;
        await existing.close();
      }
      this.startWatching(workspace);
    }
  }

  async close(): Promise<void> {
    for (const [, watcher] of this.watchers) {
      await watcher.close();
    }
    this.watchers.clear();
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private startWatching(workspace: WatchedWorkspace): void {
    const watcher = watch(workspace.repos, {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**'],
    });

    const handleEvent = (eventType: 'add' | 'change' | 'unlink', filePath: string) => {
      const key = `${workspace.slug}:${filePath}`;
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        key,
        setTimeout(() => {
          this.debounceTimers.delete(key);
          this.onChange(workspace.slug, filePath, eventType);
        }, DEBOUNCE_MS),
      );
    };

    watcher.on('add', (path) => handleEvent('add', path));
    watcher.on('change', (path) => handleEvent('change', path));
    watcher.on('unlink', (path) => handleEvent('unlink', path));

    this.watchers.set(workspace.slug, watcher);
  }
}
