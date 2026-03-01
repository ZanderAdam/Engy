import 'dotenv/config';
import type { WorkspacesSyncMessage } from '@engy/common';
import { WsClient } from './ws/client.js';
import { FileWatcher } from './watcher/index.js';

const SERVER_URL = process.env.ENGY_SERVER_URL ?? 'http://localhost:3000';

function main(): void {
  const fileWatcher = new FileWatcher((workspaceSlug, path, eventType) => {
    wsClient.send({
      type: 'FILE_CHANGE',
      payload: { workspaceSlug, path, eventType },
    });
  });

  const wsClient = new WsClient({
    serverUrl: SERVER_URL,
    onWorkspacesSync: (message: WorkspacesSyncMessage) => {
      fileWatcher.updateWorkspaces(message.payload.workspaces);
    },
  });

  wsClient.connect();

  const shutdown = () => {
    wsClient.close();
    fileWatcher.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`Engy client connecting to ${SERVER_URL}`);
}

main();
