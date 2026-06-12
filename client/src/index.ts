import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WsClient } from './ws/client.js';
import { SpecWatcher } from './watcher.js';
import { TerminalManager } from './terminal/manager.js';
import { SessionManager } from './terminal/session-manager.js';

const SERVER_URL = process.env.ENGY_SERVER_URL ?? 'http://localhost:3000';
const ENGY_DIR = process.env.ENGY_DIR ?? path.join(os.homedir(), '.engy');
const PID_FILE = path.join(ENGY_DIR, 'daemon.pid');

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePidFile(): void {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });

  try {
    fs.writeFileSync(PID_FILE, String(process.pid), { flag: 'wx' });
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // File already exists — check if the owning process is still live.
  let existingPid: number | null = null;
  try {
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const parsed = parseInt(content, 10);
    if (!isNaN(parsed)) existingPid = parsed;
  } catch {
    // Unreadable — treat as stale.
  }

  if (existingPid !== null && existingPid !== process.pid && isProcessRunning(existingPid)) {
    console.error(`[daemon] Another daemon is already running (pid=${existingPid}). Exiting.`);
    process.exit(1);
  }

  // Stale pidfile — remove and claim atomically.
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // May have been removed by the dying process — ignore.
  }

  try {
    fs.writeFileSync(PID_FILE, String(process.pid), { flag: 'wx' });
  } catch (err) {
    // Another process raced us and claimed the file first.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      console.error('[daemon] Lost pidfile race to another starting daemon. Exiting.');
      process.exit(1);
    }
    throw err;
  }
}

function releasePidFile(): void {
  try {
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    if (content === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore — file may already be gone
  }
}

function main(): void {
  console.log(`[daemon] Starting (pid=${process.pid}, node=${process.version})`);
  acquirePidFile();
  console.log(`[daemon] SERVER_URL=${SERVER_URL} ENGY_DIR=${ENGY_DIR}`);

  const sessions = new SessionManager();
  sessions.start();
  const terminalManager = new TerminalManager(sessions);

  const wsClient = new WsClient({
    serverUrl: SERVER_URL,
    onWorkspacesSync: (msg) => {
      specWatcher.sync(msg.payload.workspaces);
    },
    terminalManager,
  });

  const specWatcher = new SpecWatcher(ENGY_DIR, wsClient);

  wsClient.connect();

  const shutdown = (signal: string) => {
    console.log(`[daemon] Shutting down (${signal}), killing ${terminalManager.getAllSessions().length} sessions`);
    releasePidFile();
    sessions.stop();
    terminalManager.killAll();
    specWatcher.closeAll().then(() => {
      wsClient.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Crash handlers — log and exit so a process supervisor can restart cleanly
  process.on('uncaughtException', (err) => {
    console.error('[daemon] UNCAUGHT EXCEPTION:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[daemon] UNHANDLED REJECTION:', reason);
    shutdown('unhandledRejection');
  });

  // Periodic heartbeat to confirm daemon is alive
  const heartbeat = setInterval(() => {
    const sessionCount = terminalManager.getAllSessions().length;
    const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[daemon] heartbeat: sessions=${sessionCount} mem=${memMB}MB ws=${wsClient.connected ? 'up' : 'down'}`);
  }, 60_000);
  heartbeat.unref();

  console.log(`[daemon] Ready, connecting to ${SERVER_URL}`);
}

main();
