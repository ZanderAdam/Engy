import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import type { VoiceEvent } from '@engy/common';

import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import type { TurnRecognizer } from '../voice/recognizer';
import { createPcmDumpWriter, type PcmDumpWriter } from '../voice/pcm-dump';

/**
 * Whether the workspace behind a `/ws/voice` upgrade has opted into voice.
 * Voice is off by default, so an unknown or absent slug denies.
 */
export function isVoiceEnabledForWorkspace(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const row = getDb()
    .select({ voiceEnabled: workspaces.voiceEnabled })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get();
  return row?.voiceEnabled === true;
}

/**
 * Whether the workspace has opted into spoken replies. Deliberately separate
 * from voice input: being spoken at is its own choice, and it downloads its
 * own voice model. Requires voice too, since TTS only ever answers voice.
 */
export function isTtsEnabledForWorkspace(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const row = getDb()
    .select({ voiceEnabled: workspaces.voiceEnabled, ttsEnabled: workspaces.ttsEnabled })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get();
  return row?.voiceEnabled === true && row?.ttsEnabled === true;
}

function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sendVoiceEvent(ws: WebSocket, event: VoiceEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

/**
 * Browser ↔ server voice-dictation channel — binary frames are raw 16kHz
 * s16le mono PCM, JSON text frames are `voice_start`/`voice_stop` control.
 * Never talks to the daemon.
 *
 * One `TurnRecognizer` per cycle, held in this connection handler's closure
 * — not a shared map — which is the per-connection isolation.
 *
 * Constructing this loads no model and touches no disk: the upgrade is only
 * accepted for a voice-enabled workspace, so a workspace with voice off never
 * reaches the recognizer at all.
 */
export function createVoiceWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const workspaceSlug = new URL(req.url ?? '/', 'http://localhost').searchParams.get('workspace');

    let recognizer: TurnRecognizer | null = null;
    // Non-null for the duration of createTurnRecognizer's await — real when
    // the first connection races the ~2.5s model load. Binary frames
    // arriving in that window are buffered here and flushed in order once
    // the recognizer resolves.
    let startPromise: Promise<void> | null = null;
    let pendingChunks: Buffer[] = [];
    let stopRequested = false;
    // Created alongside the recognizer so it captures the exact PCM the
    // server received, including chunks buffered during the start window.
    let dump: PcmDumpWriter | null = null;

    async function startTurn(): Promise<void> {
      if (recognizer || startPromise) return;
      // Re-checked per turn, not just at upgrade: one connection may carry
      // many turns, so a workspace switched off mid-session must stop here.
      if (!isVoiceEnabledForWorkspace(workspaceSlug)) {
        sendVoiceEvent(ws, { t: 'voice_error', message: 'Voice is not enabled for this workspace.' });
        return;
      }
      dump = createPcmDumpWriter();
      startPromise = (async () => {
        try {
          // Dynamic so a server whose workspaces all have voice off never loads
          // the native sherpa addon — a boot-time import would, and would fail
          // the whole server on a platform the addon does not support.
          const { createTurnRecognizer } = await import('../voice/recognizer');
          const rec = await createTurnRecognizer({
            onSegment: (transcript, wake) =>
              sendVoiceEvent(ws, { t: 'voice_segment', transcript, wake }),
            onWake: () => sendVoiceEvent(ws, { t: 'voice_wake' }),
            onError: (error) => sendVoiceEvent(ws, { t: 'voice_error', message: error.message }),
          });

          const buffered = pendingChunks;
          pendingChunks = [];
          for (const chunk of buffered) rec.writeChunk(chunk);

          // voice_stop (or a connection close/error, routed through endTurn)
          // arrived while we were still starting — honour it now instead of
          // exposing a recognizer that nothing will ever stop.
          if (stopRequested) {
            rec.close();
            dump?.finish();
            dump = null;
            sendVoiceEvent(ws, { t: 'voice_final' });
          } else {
            recognizer = rec;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendVoiceEvent(ws, { t: 'voice_error', message });
          pendingChunks = [];
          dump?.finish();
          dump = null;
        } finally {
          startPromise = null;
          stopRequested = false;
        }
      })();
      return startPromise;
    }

    function endTurn(): void {
      if (recognizer) {
        // Synchronous: close() flushes and decodes the trailing segment
        // before returning, so voice_final is safe to send right after.
        recognizer.close();
        recognizer = null;
        dump?.finish();
        dump = null;
        sendVoiceEvent(ws, { t: 'voice_final' });
      } else if (startPromise) {
        stopRequested = true;
      }
    }

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        const chunk = toBuffer(data);
        dump?.write(chunk);
        if (recognizer) {
          recognizer.writeChunk(chunk);
        } else if (startPromise) {
          pendingChunks.push(chunk);
        }
        return;
      }

      let msg: { t?: string };
      try {
        msg = JSON.parse(toBuffer(data).toString('utf-8'));
      } catch {
        return;
      }

      if (msg.t === 'voice_start') {
        void startTurn();
      } else if (msg.t === 'voice_stop') {
        endTurn();
      }
    });

    ws.on('close', endTurn);
    ws.on('error', endTurn);
  });

  return wss;
}
