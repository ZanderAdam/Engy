import path from 'node:path';
import { existsSync } from 'node:fs';
import { watch, type FSWatcher, type ChokidarOptions } from 'chokidar';
import type { WsClient } from './ws/client.js';

interface WatchedWorkspace {
  slug: string;
  docsDir?: string | null;
}

interface SpecWatcherOptions {
  usePolling?: boolean;
  pollingInterval?: number;
}

// Polling default avoids libuv FSEvents interference with node-pty master-fd
// reads on macOS, which silently drops PTY child output. Spec dirs are small
// so 1s polling is cheap.
const DEFAULT_USE_POLLING = true;
const DEFAULT_POLLING_INTERVAL_MS = 1_000;

interface WatcherEntry {
  watcher: FSWatcher;
  docsDir: string | null | undefined;
}

export class SpecWatcher {
  private watchers = new Map<string, WatcherEntry>();
  private readonly engyDir: string;
  private readonly wsClient: WsClient;
  private readonly options: SpecWatcherOptions;

  constructor(engyDir: string, wsClient: WsClient, options: SpecWatcherOptions = {}) {
    this.engyDir = engyDir;
    this.wsClient = wsClient;
    this.options = options;
  }

  sync(workspaces: WatchedWorkspace[]): void {
    const desired = new Set(workspaces.map((w) => w.slug));

    for (const [slug, entry] of this.watchers) {
      if (!desired.has(slug)) {
        entry.watcher.close();
        this.watchers.delete(slug);
      }
    }

    for (const ws of workspaces) {
      const existing = this.watchers.get(ws.slug);
      if (existing && existing.docsDir === ws.docsDir) continue;

      if (existing) {
        existing.watcher.close();
        this.watchers.delete(ws.slug);
      }

      this.startWatching(ws);
    }
  }

  waitForReady(slug: string): Promise<void> {
    const entry = this.watchers.get(slug);
    if (!entry) return Promise.resolve();
    return new Promise((resolve) => {
      entry.watcher.on('ready', resolve);
    });
  }

  private startWatching(ws: WatchedWorkspace): void {
    const watchOptions: ChokidarOptions = {
      ignoreInitial: true,
      depth: 10,
    };
    if (this.options.usePolling ?? DEFAULT_USE_POLLING) {
      watchOptions.usePolling = true;
      watchOptions.interval = this.options.pollingInterval ?? DEFAULT_POLLING_INTERVAL_MS;
    }

    // Use docsDir if set, otherwise default to ENGY_DIR/slug
    const workspaceDir = ws.docsDir ?? path.join(this.engyDir, ws.slug);
    const watchPaths: string[] = [];
    for (const subdir of ['specs', 'projects']) {
      const dir = path.join(workspaceDir, subdir);
      if (existsSync(dir)) {
        watchPaths.push(dir);
      }
    }

    if (watchPaths.length === 0) return;

    const watcher = watch(watchPaths, watchOptions);

    watcher.on('all', (eventType: string, filePath: string) => {
      const mapped = mapEventType(eventType);
      if (!mapped) return;

      this.wsClient.send({
        type: 'FILE_CHANGE',
        payload: {
          workspaceSlug: ws.slug,
          path: filePath,
          eventType: mapped,
        },
      });
    });

    this.watchers.set(ws.slug, { watcher, docsDir: ws.docsDir });
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
