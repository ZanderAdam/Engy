import { WebSocketServer, type WebSocket } from 'ws';
import type { AppState } from '../trpc/context';

export function createEventsWebSocketServer(state: AppState): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    state.fileChangeListeners.add(ws);

    ws.on('close', () => {
      state.fileChangeListeners.delete(ws);
    });
    ws.on('error', () => {
      state.fileChangeListeners.delete(ws);
    });
  });

  return wss;
}
