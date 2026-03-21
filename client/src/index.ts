import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { WsClient } from './ws/client.js';
import { SpecWatcher } from './watcher.js';
import { TerminalManager } from './terminal/manager.js';
import { SessionManager } from './terminal/session-manager.js';

const SERVER_URL = process.env.ENGY_SERVER_URL ?? 'http://localhost:3000';
const ENGY_DIR = process.env.ENGY_DIR ?? path.join(os.homedir(), '.engy');

function main(): void {
  console.log(`[daemon] Starting (pid=${process.pid}, node=${process.version})`);
  console.log(`[daemon] SERVER_URL=${SERVER_URL} ENGY_DIR=${ENGY_DIR}`);

  const sessions = new SessionManager();
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
