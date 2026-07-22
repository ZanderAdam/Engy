import path from 'node:path';
import { watch, type FSWatcher, type ChokidarOptions } from 'chokidar';
import type { WsClient } from './ws/client.js';

interface WatchedWorkspace {
  slug: string;
  paths: string[];
}

interface SpecWatcherOptions {
  usePolling?: boolean;
  pollingInterval?: number;
}

// Polling default avoids libuv FSEvents interference with node-pty master-fd
// reads on macOS, which silently drops PTY child output.
const DEFAULT_USE_POLLING = true;
const DEFAULT_POLLING_INTERVAL_MS = 1_000;

interface WatcherEntry {
  watcher: FSWatcher;
  pathKey: string;
  ready: boolean;
}

function sortedPathKey(paths: string[]): string {
  return paths.join('\0');
}

// Determine whether a candidate path should be ignored given the workspace's
// subscribed paths. Dot-segments and node_modules are pruned only for content
// beneath a subscribed path, not for the subscribed path itself. Anything
// outside every subscribed path is ignored outright.
function isIgnored(candidate: string, subscribedPaths: string[]): boolean {
  for (const sp of subscribedPaths) {
    if (candidate === sp) return false;
    if (candidate.startsWith(sp + path.sep)) {
      const remainder = candidate.slice(sp.length + path.sep.length);
      const segments = remainder.split(path.sep);
      return segments.some((seg) => seg.startsWith('.') || seg === 'node_modules');
    }
  }
  return true;
}

export class SpecWatcher {
  private watchers = new Map<string, WatcherEntry>();
  private readonly wsClient: WsClient;
  private readonly options: SpecWatcherOptions;

  constructor(wsClient: WsClient, options: SpecWatcherOptions = {}) {
    this.wsClient = wsClient;
    this.options = options;
  }

  sync(workspaces: WatchedWorkspace[]): void {
    const desired = new Map(workspaces.map((w) => [w.slug, w]));

    for (const [slug, entry] of this.watchers) {
      if (!desired.has(slug)) {
        this.closeEntry(entry);
        this.watchers.delete(slug);
      }
    }

    for (const ws of workspaces) {
      const paths = [...new Set(ws.paths)].sort();
      const pathKey = sortedPathKey(paths);
      const existing = this.watchers.get(ws.slug);
      if (existing && existing.pathKey === pathKey) continue;

      if (existing) {
        this.closeEntry(existing);
        this.watchers.delete(ws.slug);
      }
      if (paths.length === 0) continue;

      this.startWatching(ws.slug, paths);
    }
  }

  waitForReady(slug: string): Promise<void> {
    const entry = this.watchers.get(slug);
    if (!entry || entry.ready) return Promise.resolve();
    return new Promise((resolve) => {
      entry.watcher.on('ready', resolve);
    });
  }

  // Detach the event relay before closing so a superseded watcher can't emit
  // stale FILE_CHANGE messages while chokidar tears down asynchronously.
  private closeEntry(entry: WatcherEntry): void {
    entry.watcher.removeAllListeners('all');
    entry.watcher.close();
  }

  private startWatching(slug: string, paths: string[]): void {
    const watchOptions: ChokidarOptions = {
      ignoreInitial: true,
      depth: 10,
      ignored: (filePath: string) => isIgnored(filePath, paths),
    };
    if (this.options.usePolling ?? DEFAULT_USE_POLLING) {
      watchOptions.usePolling = true;
      watchOptions.interval = this.options.pollingInterval ?? DEFAULT_POLLING_INTERVAL_MS;
    }

    const watcher = watch(paths, watchOptions);
    const entry: WatcherEntry = { watcher, pathKey: sortedPathKey(paths), ready: false };
    watcher.on('ready', () => {
      entry.ready = true;
    });

    watcher.on('all', (eventType: string, filePath: string) => {
      const mapped = mapEventType(eventType);
      if (!mapped) return;

      this.wsClient.send({
        type: 'FILE_CHANGE',
        payload: {
          workspaceSlug: slug,
          path: filePath,
          eventType: mapped,
        },
      });
    });

    this.watchers.set(slug, entry);
  }

  async closeAll(): Promise<void> {
    const closes = Array.from(this.watchers.values()).map((e) => e.watcher.close());
    await Promise.all(closes);
    this.watchers.clear();
  }
}

function mapEventType(event: string): 'add' | 'change' | 'unlink' | null {
  switch (event) {
    case 'add':
      return 'add';
    case 'change':
      return 'change';
    case 'unlink':
      return 'unlink';
    default:
      return null;
  }
}
