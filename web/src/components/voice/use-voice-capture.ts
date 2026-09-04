'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceEvent, VoiceStartCmd, VoiceStopCmd } from '@engy/common';

import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { useOptionalTab } from '@/components/tabs/tab-context';
import { resolveAction, type ResolveResult } from '@/lib/voice/resolve';
import type { VoiceAction } from '@/lib/voice/registry';
import { MicCapture, type MicCaptureOpts } from './mic-capture';
import { routeVoiceSegment } from './route-voice-segment';

/** Physical Right Ctrl, held to talk. Matched on `e.code`, not `e.key`,
 * since `e.key` reports `'Control'` for both sides. */
export const VOICE_PTT_CODE = 'ControlRight';

// Silence after dictation that means "I am done talking". Long enough to
// pause for thought mid-sentence, short enough not to feel stuck.
const AUTO_SUBMIT_SILENCE_MS = 2_500;

// Mirrors `WAKE_PREFIXES` in `web/src/server/voice/keywords.ts`. That module
// reads `node:fs`, which breaks the client bundle if imported here —
// `use-voice-capture.test.ts` imports the real constant and asserts it still
// equals this one, so a change there fails a test instead of drifting
// silently. Same pattern as `voice-help-dialog.tsx`.
export const WAKE_PREFIXES = ['ANGIE', 'OK ANGIE', 'OKAY ANGIE', 'HEY ANGIE', 'HELLO ANGIE'];

const DEFAULT_WORKLET_URL = '/audio-worklet.js';

export function isPttKeyEvent(e: KeyboardEvent): boolean {
  return e.code === VOICE_PTT_CODE && !e.repeat;
}

export function buildVoiceWsUrl(
  workspaceSlug: string,
  loc: { protocol: string; host: string } = window.location,
): string {
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}/ws/voice?workspace=${encodeURIComponent(workspaceSlug)}`;
}

function parseVoiceEvent(data: unknown): VoiceEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const msg = JSON.parse(data);
    return msg && typeof msg.t === 'string' ? (msg as VoiceEvent) : null;
  } catch {
    return null;
  }
}

/** `idle`: no turn in flight. `listening`: mic capturing, key held.
 * `transcribing`: key released, awaiting the tail segment and `voice_final`. */
export type VoicePhase = 'idle' | 'listening' | 'transcribing';

export interface VoiceCaptureState {
  phase: VoicePhase;
  error: string | null;
  /** Dictation segments accumulated for the current or most recently
   * completed turn, for display. Resets at the start of the next turn, the
   * same lifecycle `error` already follows. Never carries a command segment
   * — see `command`. */
  transcript: string | null;
  /** The action-registry resolution for the turn's most recent wake-word
   * segment (FR-TG2.16). Null until a wake-word segment has been seen this
   * turn — a pure dictation turn never touches it. Resets at the start of
   * the next turn. */
  command: ResolveResult | null;
}

/** `onSegment` fires on exactly one subscriber per segment, so a finalized
 * segment is inserted exactly once. */
export interface VoiceCaptureObserver {
  /** Whether this subscriber's tab is on screen. Segments go to the active
   * tab because every open tab mounts its own indicator. */
  isActiveTab?: () => boolean;
  /** Workspace the subscriber's tab belongs to — the server accepts the
   * upgrade only for one that has voice enabled. */
  workspaceSlug: () => string;
  onStateChange: (state: VoiceCaptureState) => void;
  /** Called once per finalized dictation segment (no wake word), in arrival
   * order. Each call after the turn's first dictation segment already
   * carries a leading space. Never called for a superseded or aborted turn,
   * and never called for a wake-word segment — see `onCommand`. */
  onSegment: (text: string) => void;
  /** Called once per wake-word segment, already stripped of the wake prefix
   * (FR-TG2.13). Must resolve it against the live action registry and run
   * any match; returns the outcome purely so the controller can fold it
   * into the state it broadcasts to every subscriber. A wake-word segment
   * that resolves to nothing must never fall back to `onSegment`. */
  onCommand: (text: string) => ResolveResult;
  /** Conversation mode only: fired after a stretch of silence following
   * dictation, to submit what was dictated. */
  onAutoSubmit?: () => void;
}

export interface VoicePttControllerOpts {
  wsUrlFactory?: () => string;
  workletUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  MicCaptureImpl?: new (opts: MicCaptureOpts) => Pick<MicCapture, 'start' | 'stop'>;
  /** Injectable so tests need not wait out the real silence window. */
  autoSubmitMs?: number;
}

// If no audio chunk arrives in this window, capture is silently stuck (e.g.
// a suspended AudioContext) — surface it as a visible error.
const NO_AUDIO_TIMEOUT_MS = 1500;

// Decode time scales roughly with recording length, so the timeout budget
// scales with it too; FLOOR covers short recordings where jitter, not
// decode, dominates the wait.
const FINALIZE_TIMEOUT_FLOOR_MS = 3000;
const FINALIZE_TIMEOUT_RTF_BUDGET = 0.5;

type TurnOutcome = { kind: 'final' } | { kind: 'error'; message: string } | { kind: 'discard' };

/**
 * Shared as a single instance across all `useVoiceCapture()` callers so
 * React StrictMode or multiple mounted `VoiceIndicator`s never open a second
 * mic/socket for one key press.
 */
export class VoicePttController {
  private readonly opts: VoicePttControllerOpts;
  private readonly subscribers = new Set<VoiceCaptureObserver>();
  private phase: VoicePhase = 'idle';
  private error: string | null = null;
  private transcript = '';
  private command: ResolveResult | null = null;
  private mic: Pick<MicCapture, 'start' | 'stop'> | null = null;
  private ws: WebSocket | null = null;
  private holding = false;
  // Identity-compared to discard results from a turn superseded by a newer one.
  private turnToken: object | null = null;
  private turnStartedAt = 0;
  private chunkWatchdog: ReturnType<typeof setTimeout> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  // Gates the leading space in the displayed `transcript`, across every
  // segment of the turn regardless of kind — none on the turn's first.
  private isFirstSegmentOfTurn = true;
  // Gates the leading space on text actually inserted into the terminal,
  // tracked separately: a command segment ahead of a dictation one must not
  // make the dictation segment think it already has predecessors in the
  // terminal.
  private isFirstDictationSegmentOfTurn = true;
  private conversationMode = false;
  private speaking = false;
  private autoSubmitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: VoicePttControllerOpts = {}) {
    this.opts = opts;
  }

  /** `observer` is synchronously handed the current phase/error so a
   * component mounting mid-turn renders the in-flight state, not `idle`. */
  subscribe(observer: VoiceCaptureObserver): () => void {
    const wasEmpty = this.subscribers.size === 0;
    this.subscribers.add(observer);
    if (wasEmpty) this.attach();
    observer.onStateChange({
      phase: this.phase,
      error: this.error,
      transcript: this.transcript || null,
      command: this.command,
    });
    return () => this.unsubscribe(observer);
  }

  /** The last subscriber leaving discards any turn still in flight rather
   * than leaving it running headless. */
  private unsubscribe(observer: VoiceCaptureObserver): void {
    this.subscribers.delete(observer);
    if (this.subscribers.size === 0) this.detach();
  }

  /** Tap to start, tap again to stop. A phone has no Right Ctrl, and holding
   * a button down while speaking is awkward on a touch screen. */
  toggle(): void {
    if (this.holding) this.stop();
    else this.start();
  }

  setConversationMode(on: boolean): void {
    this.conversationMode = on;
    if (!on) this.clearAutoSubmit();
  }

  isConversationMode(): boolean {
    return this.conversationMode;
  }

  /**
   * Told when Engy is talking. The mic stays open through a spoken answer, so
   * without this the answer is transcribed and dictated straight back into
   * the terminal — the loop feeds itself. Barge-in is out of scope, so words
   * spoken over the answer are dropped rather than queued.
   */
  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (speaking) this.clearAutoSubmit();
  }

  private clearAutoSubmit(): void {
    if (this.autoSubmitTimer !== null) {
      clearTimeout(this.autoSubmitTimer);
      this.autoSubmitTimer = null;
    }
  }

  // Re-armed by every dictation segment, so a pause for thought mid-sentence
  // does not submit half a thought.
  private armAutoSubmit(): void {
    this.clearAutoSubmit();
    const delay = this.opts.autoSubmitMs ?? AUTO_SUBMIT_SILENCE_MS;
    this.autoSubmitTimer = setTimeout(() => {
      this.autoSubmitTimer = null;
      this.isFirstDictationSegmentOfTurn = true;
      this.activeSubscriber()?.onAutoSubmit?.();
    }, delay);
  }

  private attach(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private detach(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (this.holding) {
      this.holding = false;
      this.clearChunkWatchdog();
      this.releaseMic();
    }
    if (this.turnToken) this.endTurn(this.turnToken, { kind: 'discard' });
  }

  // A held Right Ctrl plus another key down is a chord (e.g. Ctrl+C), not
  // dictation — abort rather than transcribe. No preventDefault, so the
  // chord still reaches the terminal.
  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.holding) {
      if (e.code !== VOICE_PTT_CODE) this.abort();
      return;
    }
    if (isPttKeyEvent(e)) this.start();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.holding || !isPttKeyEvent(e)) return;
    this.stop();
  };

  // Losing window focus mid-hold (alt-tab, OS dialog) leaves no keyup coming
  // — release the mic defensively.
  private onBlur = (): void => {
    if (this.holding) this.stop();
  };

  private start(): void {
    // A previous turn still awaiting its final is superseded, not tracked
    // alongside the new one.
    if (this.turnToken) this.endTurn(this.turnToken, { kind: 'discard' });

    this.holding = true;
    const token = {};
    this.turnToken = token;
    this.turnStartedAt = Date.now();
    this.isFirstSegmentOfTurn = true;
    this.isFirstDictationSegmentOfTurn = true;
    this.transcript = '';
    this.command = null;
    this.setPhase('listening');

    const slug = this.activeSubscriber()?.workspaceSlug();
    const url = this.opts.wsUrlFactory?.() ?? (slug ? buildVoiceWsUrl(slug) : null);
    if (!url) {
      // Without a slug the server 403s the upgrade, which would surface only
      // as a bare close.
      this.endTurn(token, { kind: 'error', message: 'No workspace to dictate into.' });
      return;
    }

    const WebSocketCtor = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new WebSocketCtor(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      const cmd: VoiceStartCmd = { t: 'voice_start' };
      ws.send(JSON.stringify(cmd));
    };
    ws.onmessage = (event) => {
      const msg = parseVoiceEvent(event.data);
      if (!msg) return;
      if (msg.t === 'voice_segment') {
        // A segment for an already-superseded/aborted turn must never be
        // inserted, even if it arrives before the socket finishes closing.
        if (this.turnToken === token) {
          const displayText = this.isFirstSegmentOfTurn ? msg.transcript : ` ${msg.transcript}`;
          this.isFirstSegmentOfTurn = false;
          this.transcript += displayText;
          this.notifyState();

          const route = routeVoiceSegment(msg.transcript, msg.wake, WAKE_PREFIXES);
          if (route.kind === 'dictation') {
            // Engy's own voice would otherwise be dictated back.
            if (!this.speaking) {
              const insertText = this.isFirstDictationSegmentOfTurn
                ? route.text
                : ` ${route.text}`;
              this.isFirstDictationSegmentOfTurn = false;
              this.emitSegment(insertText);
              if (this.conversationMode) this.armAutoSubmit();
            }
          } else {
            this.emitCommand(route.text);
          }
        }
      } else if (msg.t === 'voice_final') {
        this.endTurn(token, { kind: 'final' });
      } else if (msg.t === 'voice_error') {
        this.endTurn(token, { kind: 'error', message: msg.message });
      }
    };
    ws.onclose = () => {
      this.endTurn(token, { kind: 'error', message: 'voice connection closed' });
    };

    const MicCaptureCtor = this.opts.MicCaptureImpl ?? MicCapture;
    const mic = new MicCaptureCtor({
      workletUrl: this.opts.workletUrl ?? DEFAULT_WORKLET_URL,
      onChunk: (chunk) => {
        this.clearChunkWatchdog();
        if (ws.readyState === WebSocketCtor.OPEN) ws.send(chunk);
      },
      onError: (err) => this.endTurn(token, { kind: 'error', message: err.message }),
    });
    this.mic = mic;
    mic.start().catch((err: Error) => this.endTurn(token, { kind: 'error', message: err.message }));
    this.armChunkWatchdog();
  }

  private armChunkWatchdog(): void {
    this.chunkWatchdog = setTimeout(() => {
      this.chunkWatchdog = null;
      if (this.turnToken) {
        this.endTurn(this.turnToken, {
          kind: 'error',
          message: 'No audio captured — check microphone permissions and input device.',
        });
      }
    }, NO_AUDIO_TIMEOUT_MS);
  }

  private clearChunkWatchdog(): void {
    if (this.chunkWatchdog === null) return;
    clearTimeout(this.chunkWatchdog);
    this.chunkWatchdog = null;
  }

  private armFinalizeTimer(token: object): void {
    const recordedMs = Date.now() - this.turnStartedAt;
    const timeoutMs = Math.max(FINALIZE_TIMEOUT_FLOOR_MS, recordedMs * FINALIZE_TIMEOUT_RTF_BUDGET);
    this.finalizeTimer = setTimeout(() => {
      this.finalizeTimer = null;
      this.endTurn(token, {
        kind: 'error',
        message: 'Transcription timed out — no response from the server.',
      });
    }, timeoutMs);
  }

  /** Key released: release the mic right away so the OS mic-in-use indicator
   * clears. The socket stays open for the `voice_final` that follows. */
  private stop(): void {
    if (!this.holding) return;
    const token = this.turnToken!;
    this.holding = false;
    this.clearChunkWatchdog();
    this.releaseMic();

    const ws = this.ws;
    const WebSocketCtor = this.opts.WebSocketImpl ?? WebSocket;
    if (ws && ws.readyState === WebSocketCtor.OPEN) {
      const cmd: VoiceStopCmd = { t: 'voice_stop' };
      ws.send(JSON.stringify(cmd));
      this.setPhase('transcribing');
      this.armFinalizeTimer(token);
      return;
    }
    this.endTurn(token, { kind: 'error', message: 'voice connection closed' });
  }

  /** Tears down a turn interrupted by a chord: mic and socket close
   * immediately and no transcript is ever inserted. */
  private abort(): void {
    if (!this.holding) return;
    const token = this.turnToken;
    this.holding = false;
    this.clearChunkWatchdog();
    this.releaseMic();
    if (token) this.endTurn(token, { kind: 'discard' });
  }

  private releaseMic(): void {
    const mic = this.mic;
    this.mic = null;
    void mic?.stop();
  }

  /** Resolves the turn identified by `token` and closes its socket. A no-op
   * if `token` no longer matches the live turn (already resolved or
   * superseded), which stops a late `voice_final`/`voice_segment` landing
   * after a newer turn has started. */
  private endTurn(token: object, outcome: TurnOutcome): void {
    if (this.turnToken !== token) return;
    this.clearAutoSubmit();
    if (this.finalizeTimer !== null) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
    this.turnToken = null;
    if (this.holding) {
      // A failure mid-recording reaches here before stop() ever ran —
      // release what stop() normally would.
      this.holding = false;
      this.clearChunkWatchdog();
      this.releaseMic();
    }

    const ws = this.ws;
    this.ws = null;
    const WebSocketCtor = this.opts.WebSocketImpl ?? WebSocket;
    if (ws) {
      ws.onclose = null;
      if (ws.readyState !== WebSocketCtor.CLOSING && ws.readyState !== WebSocketCtor.CLOSED)
        ws.close();
    }

    if (outcome.kind === 'error') this.setError(outcome.message);
    this.setPhase('idle');
  }

  private setPhase(phase: VoicePhase): void {
    this.phase = phase;
    if (phase === 'listening') this.error = null;
    this.notifyState();
  }

  private setError(message: string): void {
    this.error = message;
    this.notifyState();
  }

  private notifyState(): void {
    const state: VoiceCaptureState = {
      phase: this.phase,
      error: this.error,
      transcript: this.transcript || null,
      command: this.command,
    };
    for (const subscriber of this.subscribers) subscriber.onStateChange(state);
  }

  // Prefer the visible tab — a background tab's terminals aren't what the
  // user is looking at. Falls back to the first subscriber so single-tab use
  // still works.
  private activeSubscriber(): VoiceCaptureObserver | undefined {
    for (const subscriber of this.subscribers) {
      if (subscriber.isActiveTab?.() ?? true) return subscriber;
    }
    return this.subscribers.values().next().value;
  }

  private emitSegment(text: string): void {
    this.activeSubscriber()?.onSegment(text);
  }

  // The resolution outcome comes back from the active subscriber (only it
  // has the live action vocabulary) and is folded into the state broadcast
  // to every subscriber, mirroring how `transcript` already works.
  private emitCommand(text: string): void {
    this.command = this.activeSubscriber()?.onCommand(text) ?? null;
    this.notifyState();
  }
}

let sharedController: VoicePttController | null = null;

/** The single app-wide {@link VoicePttController} every `useVoiceCapture()`
 * call subscribes to. Lazily created so importing this module never opens
 * listeners on its own. */
export function getVoicePttController(): VoicePttController {
  if (!sharedController) sharedController = new VoicePttController();
  return sharedController;
}

/** Hold Right Ctrl, speak, release — a dictation segment (no wake word) is
 * inserted into the focused terminal, unsent; a segment carrying the wake
 * word resolves against the live action registry and runs the match
 * instead (FR-TG2.16). Only mounted for a voice-enabled workspace; the
 * server rejects the upgrade otherwise. */
export function useVoiceCapture(
  workspaceSlug: string,
  actions: VoiceAction[],
): VoiceCaptureState & { toggle: () => void; answer: string | null } {
  const { insertToTerminal, submitTerminal } = useSendToTerminal();
  const tabCtx = useOptionalTab();
  // A tab with no TabContext is the only view there is, so treat it as active.
  const isActiveTab = tabCtx?.isActive ?? true;
  const liveRef = useRef({
    insertToTerminal,
    submitToTerminal: submitTerminal,
    isActiveTab,
    workspaceSlug,
    actions,
  });
  useEffect(() => {
    liveRef.current = {
      insertToTerminal,
      submitToTerminal: submitTerminal,
      isActiveTab,
      workspaceSlug,
      actions,
    };
  });

  const [state, setState] = useState<VoiceCaptureState>({
    phase: 'idle',
    error: null,
    transcript: null,
    command: null,
  });
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => {
    return getVoicePttController().subscribe({
      isActiveTab: () => liveRef.current.isActiveTab,
      workspaceSlug: () => liveRef.current.workspaceSlug,
      onStateChange: (next) => {
        // A new turn's answer is not known yet, and last turn's would read as
        // this turn's.
        if (next.phase === 'listening') setAnswer(null);
        setState(next);
      },
      onSegment: (text) => {
        // A dropped inject (wrong tab, no active panel, no socket) is silent
        // by default — recognised speech must never disappear unreported.
        if (!liveRef.current.insertToTerminal(text)) {
          setState((s) => ({ ...s, error: 'Recognised, but no terminal accepted it.' }));
        }
      },
      onAutoSubmit: () => {
        liveRef.current.submitToTerminal();
      },
      onCommand: (text) => {
        const resolved = resolveAction(text, liveRef.current.actions);
        // Never a terminal fallback here — an unresolved command stays
        // unresolved, visibly (FR-TG2.16), rather than typing the phrase
        // into a shell.
        if (resolved.matched) {
          void Promise.resolve(resolved.result.action.run({ params: resolved.result.params }))
            .then((answer) => setAnswer(answer ?? null))
            .catch((e: unknown) => setAnswer(e instanceof Error ? e.message : 'Action failed.'));
        }
        return resolved;
      },
    });
  }, []);

  const toggle = useCallback(() => getVoicePttController().toggle(), []);

  return { ...state, answer, toggle };
}
