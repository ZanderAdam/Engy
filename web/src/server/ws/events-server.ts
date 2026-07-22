import { WebSocketServer, type WebSocket } from 'ws';
import type { AppState } from '../trpc/context';
import { handleWatchSubscribe, dropWatchSocket } from './watch-subscriptions';

export function createEventsWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    state.fileChangeListeners.add(ws);

    ws.on('message', (raw: Buffer | string) => {
      let msg: { type: string; payload: unknown };
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
      } catch {
        return;
      }

      if (msg.type === 'WATCH_SUBSCRIBE') {
        handleWatchSubscribe(state, ws, msg.payload);
      }
    });

    ws.on('close', () => {
      state.fileChangeListeners.delete(ws);
      dropWatchSocket(state, ws);
    });

    ws.on('error', () => {
      state.fileChangeListeners.delete(ws);
      dropWatchSocket(state, ws);
    });
  });

  return wss;
}
