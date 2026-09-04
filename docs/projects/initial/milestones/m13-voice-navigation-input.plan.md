---
title: Voice Navigation & Input
status: draft
---

# Plan: M13 Voice Navigation & Input

## Overview

M13 adds voice as a second input head to Engy: speech-to-text dictation into terminal sessions, and spoken navigation across and within projects. Audio is captured in the browser, streamed over a dedicated WebSocket to the server, and transcribed in-process by a local ASR model. Recognized text either dispatches a navigation action or is staged into a terminal for the user to send. Nothing leaves the machine.

After TG1 passed its gate, TG2 and TG3 were replanned around a wake word and an always-on session, replacing the original push-to-talk-only command model. The wake word is what makes always-on safe: it decides whether speech was addressed to the machine at all, so unaddressed speech is discarded undecoded rather than typed into a terminal.

**TG1 is a go/no-go gate.** It builds the thinnest possible end-to-end path — hold a key, speak, see text land in the focused terminal — and stops. If dictation into a live agent terminal does not feel worth the friction, M13 ends there and TG2/TG3 are dropped. TG1 is deliberately under-built: no action registry, no HUD chrome, no settings, no persistence. Do not gold-plate it; its only job is to answer the question.

Boundary: no TTS, no agent voice responses, no barge-in, no speaker identification, no multi-language support, no per-terminal voice assignment, no changes to the existing cmdk palette. (A wake word was out of scope when this was written and is now TG2's core mechanism — see the replan note above.) Voice commands are terminal-only: project and tab navigation shipped, proved unreliable in use, and was removed — terminal control is what the feature is for, and each extra action costs match accuracy against the ones that matter.

## Codebase Context

**Verified reusable — port, do not rewrite.** `/home/aleks/dev/crouton/` (a separate project by the same author) already solved the browser capture path against Azure Speech. Two files are backend-agnostic and carry over unchanged:

- `crouton/web/public/audio-worklet.js` — `DownsampleProcessor`, registered as `"downsample-16k"`. Reads device-rate mic input, linearly interpolates to 16 kHz, converts Float32 → Int16, posts a transferable `ArrayBuffer` every 320 samples (20 ms, 640 bytes). Mono, channel 0 only. This is exactly the format a streaming zipformer consumes.
- `crouton/web/src/session/voice/mic-capture.ts` — `MicCapture` class. `getUserMedia` with `echoCancellation`/`noiseSuppression`, AudioContext + worklet wiring, forwards chunks via `onChunk`, and on `stop()` stops all tracks and closes the context so the OS mic indicator clears. Deliberately does not connect to `ctx.destination`.

**Reference, adapt the shape only:**

- `crouton/src/azure-speech.ts` defines the clean STT seam: `TurnRecognizer { writeChunk(chunk: Buffer): void; close(): void }` with `TurnRecognizerOpts { onPartial, onFinal, onError }`. Implement this exact interface against sherpa-onnx-node instead of Azure's SDK.
- `crouton/web/src/secure-context-banner.tsx` — checks `window.isSecureContext`, renders remediation guidance. Adapt copy in TG3.
- Crouton routes STT through a separate MCP stdio process dialing back into the web server. **Do not copy this.** That indirection exists because Claude-as-tutor drives the turn. Engy runs the recognizer in-process in the Node server and dispatches directly.

**Engy-side constraints that shape the design:**

- **Terminal session source of truth is the server registry, not the browser store.** `terminalSessionMeta` (driven by daemon `{t:'act'}` messages, mirrored to SQLite, exposed via `GET /api/terminal/sessions?all=1`) is authoritative. `web/src/components/terminal/terminal-session-store.ts` only holds what a currently-mounted `TerminalManager` publishes for the *currently open* project — unmounted projects publish nothing. Resolving "terminal 2" by ordinal MUST read the server registry. See `docs/memory/patterns/20260801213516-cross-cutting-terminal-views-read-the-server-registry-not-th.md` and `docs/system/features/terminal-relay.md#FR-TERMINAL-170`.
- **Terminal focus already has a signal.** Focusing a terminal sends `{t:'ack', sessionId}`; the server clears `activityState`, persists, broadcasts, and forwards to the daemon (`FR-TERMINAL-240`). Voice-driven focus emits the same ack rather than inventing a parallel path.
- **New WS endpoints are one-per-concern.** Engy runs four independent `WebSocketServer` instances (`/ws`, `/ws/terminal`, `/ws/terminal-relay`, `/ws/events`), each with its own typed message set in `common/src/ws/protocol.ts` and handler under `web/src/server/ws/`. `/ws/voice` is the correct shape — do not fold audio into `/ws/terminal`. Browser-only message types are typed in the shared contract but excluded from the daemon-facing relay union and intercepted by string-prefix match before the generic daemon forward. See `docs/system/features/websocket-daemon-protocol.md`.
- **Tab navigation must route through `navigateOrReuseTab`** (`web/src/components/tabs/tab-state.ts`). It focuses an existing tab sharing the same `projectTabKey` instead of navigating in place. Calling `pushVirtual`/`updateTabPath` directly is the documented root cause of duplicate-tab bugs.
- **`common/` is types-only by explicit decision.** Any runtime logic needed on both sides of the WS boundary gets duplicated per-package and added to `.jscpd.json`'s ignore list, not hoisted. Precedent: `activity-parse.ts`/`activity-tracker.ts`.
- **In-process local models have precedent.** M7's `@tobilu/qmd` runs `node-llama-cpp` with local GGUF models in-process, deliberately avoiding a sidecar. `sherpa-onnx-node` matches this shape. `better-sqlite3` is already a native addon in `web/`. **Model asset storage is unprecedented** — no zettel covers vendoring, `.gitignore`, or download-on-install.
- Terminal inject: `useSendToTerminal` (`web/src/components/terminal/use-send-to-terminal.ts`) already accepts an optional `terminalId`, so it is designed for external, non-focus-driven targeting. Note it appends `\r` 50 ms after the content — dictation needs a variant that stops short of that.

**Measured on this hardware** (i7-4790K, CPU only, `sherpa-onnx-node` 1.13.6, `numThreads: 2`):

| Path | Result |
|---|---|
| streaming zipformer 20M, int8 | RTF 0.060; 5.9 ms avg per 100 ms chunk; **14 ms tail after speech ends** |
| parakeet-tdt-0.6b int8 (offline) | RTF 0.184 at `numThreads: 2`; **RTF 0.08–0.13 at `numThreads: 4`** (~260 ms for 2 s of speech, ~350 ms for 4 s, ~2.2 s for 24 s); 2.5 s model load; 631 MB on disk; correct punctuation and casing |

| Silero VAD + offline parakeet, segment-at-a-time | RTF 0.064 over a real 24 s dictation (1533 ms total compute); each phrase's text lands ~360 ms after the speaker pauses, dominated by `minSilenceDuration: 0.35`, not decode |

**No streaming model is available or needed.** sherpa-onnx publishes `parakeet-unified-en-0.6b-int8-streaming-*` tarballs, but the runtime has no true online decode path for them — [k2-fsa/sherpa-onnx#3573](https://github.com/k2-fsa/sherpa-onnx/issues/3573) is the open request, and the shipped Android demo uses the *non-streaming* model. Measured here, all three streaming variants decode at RTF ~8 (8× slower than real time) regardless of `modelType`, because each chunk re-encodes. Voice-activity segmentation gives phrase-by-phrase output at RTF 0.064 instead, so it supersedes the question rather than waiting on upstream.

**Superseded during TG1.** The 20M streaming model measured well but is unusable in practice — it systematically drops the first word or syllable of an utterance ("Hello" → `O`, "Does this work?" → `'S THIS WORK`). Verified by A/B-ing both models over identical captured audio, so the difference is the model, not the microphone. TG1 ships parakeet instead; see the Completion Summary.

No GPU needed. The npm package `sherpa-onnx` is the single-threaded WASM build — the native multithreaded addon is `sherpa-onnx-node`. No GPU variant is published to npm (`sherpa-onnx-linux-x64-gpu` 404s); CUDA requires a source build. `OnlineRecognizer` ships built-in endpointing (`enableEndpoint`, `rule1/2/3MinTrailingSilence`) and hotword biasing (`hotwordsFile`, `hotwordsScore`).

## Task Group Sequencing

- **TG1: Dictation MVP (gated)** — no dependencies. Can start immediately. **Ends in an explicit go/no-go decision.**
- **TG2: Wake Word & Command Resolution** — depends on TG1 passing its gate (reuses the capture path, `/ws/voice` transport, VAD segmentation, and recognizer wholesale). **Gate passed; TG2 is live.**
- **TG3: Always-On Session, Modes & Safety** — depends on TG2 (needs the spotter to reject unaddressed speech and the registry to reject low-confidence input before a mic can be left open).

If TG1's gate fails, TG2 and TG3 are dropped and the milestone closes.

## TG1: Dictation MVP (gated)

The thinnest end-to-end slice that answers "is voice input into a terminal worth building?" Hold a key, speak, release; transcribed text appears in the focused terminal's input, unsent. Nothing else. Three tasks, deliberately minimal — no action registry, no navigation, no persistence, no open-mic. The one setting is the per-workspace on/off switch, which exists so the model download is opt-in.

**Explicitly out of scope for TG1, even if tempting:** transcript HUD styling, confidence display, undo, per-terminal targeting, punctuation restoration, model choice UI, reconnect/backoff hardening.

### Requirements

1. The system shall stream 16 kHz s16le mono PCM from the browser to the server over a dedicated `/ws/voice` WebSocket while a push-to-talk key is held. *(source: user request)* (FR-TG1.1)
2. The system shall transcribe streamed audio in-process using a local streaming ASR model, with no network egress. *(source: user request)* (FR-TG1.2)
3. The system shall download and cache ASR model assets under `ENGY_DIR` when a workspace first enables voice, and shall not commit model binaries to the repository. The cache is keyed by `ENGY_DIR`, not by workspace, so a second workspace enabling voice reuses the existing download. *(inferred: 630 MB assets, no vendoring precedent exists; revised during TG1 from "on first use" — see FR-TG1.7)* (FR-TG1.3)
4. The system shall emit a finalized transcript for each detected speech segment as it closes, and shall flush any trailing segment when the push-to-talk key is released. *(revised during TG1: the original wording promised streaming "interim transcripts", which an offline recogniser cannot produce. Voice-activity segmentation delivers the same phrase-by-phrase feedback without a streaming model — each message is a finalized segment, never a revision of a growing hypothesis)* (FR-TG1.4)
5. The system shall insert the final transcript into the focused terminal without submitting it. *(source: user request — never auto-submit into a live agent terminal)* (FR-TG1.5)
6. The system shall degrade with a visible error, not a silent failure, when the page is not a secure context or the mic is denied. *(inferred: Tailscale/mobile access makes this a real path)* (FR-TG1.6)
7. The system shall treat voice as opt-in per workspace, off by default, and while it is off shall perform no model download, no model load, and no native-addon load. *(source: user request — "with it off it should be no op - nothing downloads")* (FR-TG1.7)
8. When a workspace switches voice from off to on, the system shall begin fetching the model assets at that moment, without blocking the settings save. *(inferred from FR-TG1.7: the download has to happen somewhere, and the opt-in moment is the only point the user has signalled they want it)* (FR-TG1.8)
9. The system shall reject a `/ws/voice` upgrade whose workspace has not enabled voice. *(inferred from FR-TG1.7: the client gate alone leaves the server reachable)* (FR-TG1.9)
10. The system shall offer a tap-to-start, tap-to-stop control on a touch screen, in addition to the held key. *(source: user request — a phone has no Right Ctrl, so the key alone makes dictation unreachable there. Toggle rather than hold follows the crouton precedent, where holding a button while speaking proved awkward on touch)* (FR-TG1.10)

### Tasks

1. **Local STT engine + model bootstrap in `web/`**
   - Files: `web/src/server/voice/recognizer.ts` [NEW], `web/src/server/voice/models.ts` [NEW], `web/src/server/voice/recognizer.test.ts` [NEW], `web/package.json` [MODIFY], `.gitignore` [MODIFY]
   - Implements FR-TG1.2, FR-TG1.3
   - Add `sherpa-onnx-node` (NOT `sherpa-onnx` — that is the WASM build). Implement the `TurnRecognizer { writeChunk, close }` / `TurnRecognizerOpts { onPartial, onFinal, onError }` interface from `crouton/src/azure-speech.ts` against `OnlineRecognizer`, config nested under `modelConfig`, `numThreads: 2`, `provider: 'cpu'`, `enableEndpoint: true`. `models.ts` resolves the model dir under `ENGY_DIR`, downloads and extracts `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17` from the k2-fsa GitHub release on first use, and is idempotent. Load the recognizer once and reuse it — model load measured at ~1.3 s.
   - Verify: `cd web && pnpm vitest run src/server/voice/recognizer.test.ts` — feed a fixture wav, assert a non-empty final transcript.

2. **`/ws/voice` endpoint + protocol types** (depends on task 1)
   - Files: `common/src/ws/protocol.ts` [MODIFY], `web/src/server/ws/voice-server.ts` [NEW], `web/src/server/ws/voice-server.test.ts` [NEW], `web/src/server/server.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.4
   - Fifth `WebSocketServer` instance following the existing four. Binary frames carry raw PCM; JSON text frames carry control (`{t:'voice_start'}`, `{t:'voice_stop'}`, `{t:'voice_partial', transcript}`, `{t:'voice_final', transcript}`, `{t:'voice_error', message}`). These are browser-only — type them in the shared contract but exclude them from the daemon-facing relay union and intercept by string-prefix match before the generic daemon forward. State must be keyed per connection from the start; crouton's single global `BridgeState` is a known limitation, not a model to copy.
   - Verify: `cd web && pnpm vitest run src/server/ws/voice-server.test.ts` — two concurrent connections get independent recognizers and independent transcripts.

3. **Browser capture + push-to-talk + terminal insert** (depends on task 2)
   - Files: `web/public/audio-worklet.js` [NEW — port from crouton], `web/src/components/voice/mic-capture.ts` [NEW — port from crouton], `web/src/components/voice/use-voice-capture.ts` [NEW], `web/src/components/voice/voice-indicator.tsx` [NEW], `web/src/components/voice/use-voice-capture.test.ts` [NEW], `web/src/components/terminal/use-send-to-terminal.ts` [MODIFY]
   - Implements FR-TG1.1, FR-TG1.5, FR-TG1.6
   - Port the two crouton files unchanged. `use-voice-capture.ts` owns the PTT keybinding (must bail via `isTypingTarget()` from `web/src/lib/keyboard.ts` so it never steals keystrokes from xterm or an input), opens `/ws/voice` on key-down, streams chunks, closes on key-up. Add a `sendToTerminal` variant that inserts without the trailing `\r`. `voice-indicator.tsx` is a minimal listening dot plus the live partial transcript — plain text, no styling investment. Surface secure-context and permission failures inline.
   - Verify: `cd web && pnpm vitest run src/components/voice/`, then `pnpm blt`, then manual — hold the key, speak, confirm text lands unsent in the focused terminal.

**Parallelizable:** none. All three tasks are strictly sequential — each consumes the previous task's interface.

### Gate

After TG1, stop and evaluate before any TG2 work:

- Does dictation into a terminal beat typing for real prompts, or only for short ones?
- Is 20M-model accuracy sufficient on your actual mic and voice, or does it need the larger zipformer / parakeet? (Measured WER on real mic input is unknown — the benchmark used a clean studio clip.)
- Does the PTT ergonomic hold up over a working session?
- Does it work over Tailscale on the phone?

**Proceed to TG2 only on an explicit yes.** Record the decision in this document's Completion Summary either way.

### Completion Summary

**Gate: PASS.** Dictation into a terminal is worth building on. Proceed to TG2.

Answers to the gate questions, including where the question itself went stale:

- **Beats typing for real prompts?** Yes, for prompt-length text. Not evaluated for short commands, which is what TG2 covers.
- **Is 20M-model accuracy sufficient?** Question is obsolete. The 20M streaming zipformer was rejected during TG1 — it systematically dropped the first word or syllable of short utterances ("Hello" decoded as `O`), proven by A/B on identical captured bytes. Shipped model is `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`, offline, RTF 0.06–0.13 at `numThreads: 4`.
- **PTT ergonomics?** Right Ctrl held up. F9 was rejected as unergonomic before implementation.
- **Works on the phone?** Yes, but not over a plain Tailscale IP — `http://100.x.x.x` is not a secure context, so `getUserMedia` refuses. Reaching it needs either HTTPS (`tailscale serve`, which requires enabling tailnet HTTPS certs and publishes device FQDNs to public Certificate Transparency logs) or Chrome's *insecure origins treated as secure* allowlist on the phone. The allowlist was chosen for testing; it stores a full origin, which is why the dev port is pinned.

**What shipped, that TG2 builds on:**

- `VoiceProvider` / `useOptionalVoice` (`components/voice/voice-context.tsx`) is the single access point for voice state and the `toggle()` control. It returns `null` when the workspace has voice off. Subscribing is what arms the mic, so the provider only mounts its subscribing inner component for an enabled workspace — consume the context, never call `useVoiceCapture` directly.
- `voice-indicator.tsx` is status-only (listening / transcribing / error) and doubles as the stop control while listening. TG2 task 3 extends it with transcript + matched action + confidence.
- Touch trigger is a mic key in `terminal/mobile-terminal-controls.tsx`, behind the `...` column, wired from `terminal.tsx` via `onMic`/`micListening`. Absent when voice is off.
- Voice is opt-in per workspace (`workspaces.voiceEnabled`, default false). `/ws/voice` requires `?workspace=<slug>` and 403s a workspace that has not opted in; `startTurn` re-checks per turn. Nothing — model download, model load, native addon import — is reachable while voice is off.
- Segmentation is Silero VAD closing on `minSilenceDuration: 0.2`, each closed segment decoded offline and emitted immediately. Each `voice_segment` is finalized text for its own span, never a revision of a growing hypothesis.

**Warnings for TG2:**

- Task 2 assumes the recognizer accepts `hotwordsFile`/`hotwordsScore`. Verify that against `OfflineRecognizer` with `modelType: 'nemo_transducer'` **before** building on it — sherpa's hotword support is tied to particular decoding methods and modeling units, and may not apply to this model. If it does not, biasing has to live entirely in the fuzzy matcher, which changes the task's shape.
- `sherpa-onnx-node` has two traps that tests do not catch: its CommonJS exports are invisible to Node's ESM lexer (use `createRequire`, a named import passes vitest and throws in the real server), and referencing it from anything a tRPC router reaches pulls the `.node` binary into the Next webpack bundle (it is in `serverExternalPackages` for that reason).
- Every TG1 bug was a silent drop — audio dropped during model load, socket closed before the final, inject discarded on tab id, segment delivered to a tab with no terminal. Fake-socket unit tests structurally could not catch them. Prefer replaying real audio against a live server for anything on the capture path.

**Not done:** no `docs/system/features/` area doc for voice — the area is still tracked by local `FR-TG1.N` ids here. Author it via `/engy:feature-docs` before voice is considered shipped.

## TG2: Wake Word & Command Resolution

Makes voice addressable. A wake word decides whether speech is meant for the machine at all; only speech that carries it is decoded as a command. Reuses TG1's capture path, transport, VAD segmentation, and offline recognizer without modification.

Replanned after TG1. The original TG2 assumed commands arrive because a key is held, so nothing had to decide whether speech was addressed to the app. Always-on removes that guarantee and makes addressing the central problem, which is what the wake word solves.

`global-search.tsx` is not touched — the registry is a new, voice-only consumer, and navigation actions are defined in it independently of the existing palette.

### How a turn works

Three stages, each waking the next, so silence and unaddressed speech cost almost nothing:

1. **Silero VAD** (shipped in TG1) gates on speech and defines the utterance span.
2. **KeywordSpotter** (`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`, streaming, int8) scans continuously for the wake word.
3. **Parakeet** (shipped in TG1, offline) decodes a VAD segment only when the spotter fired inside it.

The wake word and the command are one utterance — "Angie, select project web" — because the spotter says *whether* to decode while VAD says *what span* to decode. The resolver strips the wake prefix before matching. A segment with no wake hit is discarded undecoded.

This is why TG1's lack of a streaming recognizer does not block always-on: what always-on needs is streaming *keyword spotting*, and that is a separate, purpose-built model the library already provides.

### Requirements

1. The system shall maintain an action registry of typed, named actions with speakable phrase templates and typed parameters. *(source: user request)* (FR-TG2.1)
2. The system shall build its recognition vocabulary from the terminals open at recognition time. *(inferred: names change at runtime; narrowed from "open projects, tab names, and terminal sessions" when project and tab navigation were dropped)* (FR-TG2.2)
3. The system shall resolve a transcript to an action by exact phrase match, then by phonetic fuzzy match, and shall reject rather than guess below a confidence threshold. *(inferred: STT mangles slugs; a wrong navigation is cheap but a wrong dispatch is not)* (FR-TG2.3)
5. The system shall resolve terminal references by number or label against the terminals currently open on screen, and shall number them in that order. *(revised after testing: the original resolved against the server session registry, which lists sessions that have no open dockview panel — focusing one silently did nothing, because focus works by activating a panel. Numbering what cannot be focused also made every number wrong.)* (FR-TG2.5)
6. The system shall focus a voice-selected terminal by emitting the existing `{t:'ack', sessionId}` signal. *(inferred: FR-TERMINAL-240 already owns this path)* (FR-TG2.6)
7. The system shall display the recognized transcript, the matched action, and the match confidence before or as it acts. *(source: user request — feedback loop is what makes command voice usable)* (FR-TG2.7)
8. The system shall provide a help surface listing every registered voice action and its phrase templates, derived from the action registry rather than a maintained list. *(source: user request)* (FR-TG2.8)
9. The help surface shall show the live vocabulary — current project, tab, and terminal names — resolved into example phrases the user can actually say. *(inferred: a template like "select project &lt;name&gt;" is not actionable without knowing the valid names)* (FR-TG2.9)
10. The help surface shall be reachable by voice as well as by keyboard. *(inferred: a hands-free feature whose discovery requires the keyboard defeats itself)* (FR-TG2.10)
11. The system shall detect a configurable wake word in the audio stream using a streaming keyword spotter, independently of the offline recognizer. *(source: user request — "maybe if I say a keyword")* (FR-TG2.11)
12. In push-to-talk, the system shall decode every speech segment of a turn, and shall treat the wake word as selecting *what to do with* the transcript rather than *whether to produce* one. *(revised after testing: the original required a wake word before decoding at all, which broke dictation — the key hold is already a deliberate gesture, so there is nothing for a wake word to authorise. Wake-required decoding belongs to always-on, where no gesture exists — see FR-TG2.14)* (FR-TG2.12)
13. The system shall strip the wake word from the transcript before resolving it against the action registry. *(inferred: the wake word is addressing, not part of the command)* (FR-TG2.13)
14. In always-on, the system shall discard, without decoding or reporting, any speech segment carrying no wake word while dictation mode is inactive. *(discarding is what makes an open mic safe to leave running; scoped to always-on after testing showed it wrongly disabled push-to-talk dictation)* (FR-TG2.14)
16. In push-to-talk, the system shall insert a transcript carrying no wake word into the focused terminal, and shall resolve a transcript carrying one against the action registry instead. *(source: user request — "dual mode, should work with input (default) and command execution")* (FR-TG2.16)
15. The system shall report a wake-word detection to the browser distinctly from a transcript, so the user can see it was addressed even when resolution then fails. *(inferred from TG1's recurring failure mode: every bug was a silent drop, and "it did not hear me" and "it heard me but did not understand" need different fixes)* (FR-TG2.15)
17. The system shall display each open terminal's spoken number on the terminal rail while voice is enabled. *(source: user request — "we should also number terminals when in voice mode so its easier"; a number nobody can read is not speakable)* (FR-TG2.17)
18. The system shall report the status of all open terminals, and of one named terminal, in answer to a voice command, ordering the summary so terminals awaiting the user come first. *(source: user request — "get terminal status, tells me status of terminals")* (FR-TG2.18)
20. The system shall submit the focused terminal's typed input on a spoken command, separately from dictating it. *(source: user request — "I need a 'send message' or angie send, so send in terminal"; dictation deliberately never auto-submits into a live agent terminal, so submitting has to be its own step)* (FR-TG2.20)
21. When asked about one terminal, the system shall focus it, and shall ask an agent terminal to answer out loud rather than describing it from the outside. *(source: user request — "auto focus that terminal and allow me to have a convo with its agent"; only the agent knows what it is actually doing, and focusing is what makes the next dictated words land there)* (FR-TG2.21)
22. The system shall speak at most one utterance at a time. *(inferred: spoken answers arrive from independent sources — a local acknowledgement and an agent's `speak` — and two voices at once are unintelligible)* (FR-TG2.22)
23. The system shall render spoken answers locally, and shall cap an over-long utterance rather than speaking all of it. *(inferred: a spoken answer cannot be skimmed or interrupted)* (FR-TG2.23)
24. An agent shall be able to answer the user out loud through an MCP tool, only while the workspace has opted into spoken replies. *(source: user request — "new tts tool for mcp")* (FR-TG2.24)
25. Spoken replies shall be opt-in per workspace, separately from voice input, and shall download their voice only on opt-in. *(inferred: the existing voice opt-in set this precedent — no model is fetched until the feature is turned on)* (FR-TG2.25)
26. The system shall speak a multi-line answer as one utterance per line, with a pause between them. *(source: user report — "we need a lil pause between terminal readouts, its all one mush together"; measured, the voice's longest pause is ~0.15s whatever the punctuation, so the gap cannot come from the text)* (FR-TG2.26)
19. A matched action shall be able to answer in text, and the system shall display that answer. *(inferred: a status command has no visible side effect, so without this its result is invisible)* (FR-TG2.19)

### Tasks

1. **Action registry core + phonetic resolver in `web/`**
   - Files: `web/src/lib/voice/registry.ts` [NEW], `web/src/lib/voice/resolve.ts` [NEW], `web/src/lib/voice/resolve.test.ts` [NEW], `web/src/lib/voice/phonetic.ts` [NEW], `web/src/lib/voice/phonetic.test.ts` [NEW]
   - Implements FR-TG2.1, FR-TG2.3, FR-TG2.13
   - `{ id, title, phrases[], params, run(ctx) }`. Double Metaphone + edit distance for tier 2. Wake-prefix stripping is a pure function here, tolerant of the spotter's own transcription of the wake word and of trailing punctuation ("Angie," / "Engie" / "A N G").
   - Pure functions, no React, no I/O — the most testable part of the milestone, and it should carry the densest unit tests. Table-test against real STT mangles of actual project slugs (`engy-web` -> "engie web", "n g web", "energy web").
   - Unaffected by the wake-word redesign; can start before the spotter exists.
   - Verify: `cd web && pnpm vitest run src/lib/voice/`

2. **Wake-word spotter: model bootstrap + keyword encoding in `web/`**
   - Files: `web/src/server/voice/kws-models.ts` [NEW], `web/src/server/voice/kws-models.test.ts` [NEW], `web/src/server/voice/keywords.ts` [NEW], `web/src/server/voice/keywords.test.ts` [NEW]
   - Implements FR-TG2.11 (model half)
   - Download and cache `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` (int8) beside the parakeet model under `{ENGY_DIR}/models/`, reusing `models.ts`'s atomic staging-then-rename and its "already complete, do not refetch" guard. It is ~3.3M params, so the download is small next to parakeet's 630MB.
   - The spotter's keywords file wants token sequences, not words — the same encoding chore as hotwords, but tractable here because **this model ships `bpe.model`** (parakeet does not) and the wake word is one fixed phrase encoded once at config time, not a live vocabulary regenerated per turn. Format is `TOKENS @KEYWORD_ID` with an optional per-keyword threshold and boost. Port the `text2token` BPE encoding rather than shelling out to the Python CLI.
   - Gate the download behind `voiceEnabled` exactly as TG1 gates parakeet's — see `isVoiceEnabledForWorkspace` and the preload-on-opt-in path in `workspace.update`.
   - Verify: `cd web && pnpm vitest run src/server/voice/kws-models.test.ts src/server/voice/keywords.test.ts` — assert a warm cache never fetches, and that a known phrase encodes to the expected token sequence.

3. **Wake-gated turn routing in `web/`** (depends on task 2)
   - Files: `web/src/server/voice/recognizer.ts` [MODIFY], `web/src/server/voice/spotter.ts` [NEW], `web/src/server/voice/spotter.test.ts` [NEW], `web/src/server/ws/voice-server.ts` [MODIFY], `common/src/ws/protocol.ts` [MODIFY]
   - Implements FR-TG2.11 (runtime half), FR-TG2.12, FR-TG2.14, FR-TG2.15
   - Feed each PCM chunk to both the VAD and a `KeywordSpotter` `OnlineStream`. When a VAD segment closes, decode it with parakeet only if the spotter fired within its span; otherwise drop it without decoding. Add a `voice_wake` event to the protocol so the browser can show it was addressed even when resolution later fails.
   - Keep the per-turn isolation TG1 established: the recognizer is shared and loaded once, the VAD is per turn. Decide deliberately which the spotter is, and write down why — a spotter carrying state across turns will fire on a stale hit.
   - **Do not** regress TG1's guarantees: the `/ws/voice` upgrade stays gated on `voiceEnabled`, `startTurn` keeps its per-turn re-check, and nothing may reach a model or the native addon while voice is off.
   - Known risk: sherpa's KWS has reported false-reject problems ([issue #2678](https://github.com/k2-fsa/sherpa-onnx/issues/2678)). Measure the accept and reject rate on real recordings of the chosen wake word before tuning anything else, and report the numbers. `keywordsThreshold` and the per-keyword boost are the knobs.
   - Verify: `cd web && pnpm vitest run src/server/voice/ src/server/ws/`, plus a replay of a real recording against the live server. TG1's lesson stands: fake-socket unit tests cannot catch the timing and lifecycle bugs on this path.

4. **Live vocabulary + navigation and terminal-focus actions in `web/`** (depends on task 3)
   - Files: `web/src/components/voice/use-voice-vocabulary.ts` [NEW], `web/src/components/voice/use-voice-vocabulary.test.ts` [NEW], `web/src/lib/voice/actions/navigation.ts` [NEW], `web/src/lib/voice/actions/terminal.ts` [NEW], `web/src/lib/voice/actions/navigation.test.ts` [NEW], `web/src/components/voice/voice-indicator.tsx` [MODIFY]
   - Implements FR-TG2.2, FR-TG2.5, FR-TG2.6, FR-TG2.7, FR-TG2.17, FR-TG2.18, FR-TG2.19, FR-TG2.20
   - Assemble projects/tabs/terminals into a vocabulary. Terminals come from `GET /api/terminal/sessions?all=1`, never `terminal-session-store.ts` — the browser store drops unmounted projects.
   - Register "select project X", "open tab Y", "focus terminal N". Navigation goes through `navigateOrReuseTab` (`web/src/components/tabs/tab-state.ts`); focus emits `{t:'ack', sessionId}`.
   - ASR-level hotword biasing of this vocabulary is **out of scope**. It needs `decodingMethod: 'modified_beam_search'` plus hand-rolled BPE tokenization against parakeet's `tokens.txt` (which ships no bpe vocab), and it would cost the greedy-decode latency TG1 measured. FR-TG2.2 requires only that the vocabulary be built from live state, not pushed into the ASR. The phonetic resolver carries it.
   - Indicator state as of TG1, since the earlier plan text is stale: it reads from `useOptionalVoice()` (`components/voice/voice-context.tsx`), which returns `null` when voice is off; while listening it renders as a `<button>` that stops the turn; it is `fixed bottom-4 left-4 z-[60]`, where the z-index is load-bearing against the mobile terminal sheet. Do not call `useVoiceCapture` directly, and do not add a start control here.
   - Verify: `cd web && pnpm vitest run src/lib/voice/actions/ src/components/voice/use-voice-vocabulary.test.ts`, then `pnpm blt`, then `pnpm exec playwright-cli` to confirm no duplicate tabs. Assert terminals from an unmounted project still appear.

5. **Voice help surface in `web/`** (depends on task 4)
   - Files: `web/src/components/voice/voice-help-dialog.tsx` [NEW], `web/src/components/voice/voice-help-entries.ts` [NEW], `web/src/components/voice/voice-help-entries.test.ts` [NEW], `web/src/lib/voice/actions/help.ts` [NEW]
   - Implements FR-TG2.8, FR-TG2.9, FR-TG2.10
   - A dialog (reuse `components/ui/dialog`) enumerating every registry action, grouped by category. `voice-help-entries.ts` is the pure part: registry plus live vocabulary expanded into concrete example phrases — `select project <name>` renders as the actual open project names, capped with a "+N more" affordance, degrading to the bare template when a parameter has no live values.
   - Show the current wake word in the examples, so the help text reads as something the user can say verbatim.
   - Register a `voice.help` action with phrases like "what can I say", "show voice help", "help". Own the keyboard trigger inside `voice-help-dialog.tsx` (bail via `isTypingTarget()` from `web/src/lib/keyboard.ts`), **not** in `voice-indicator.tsx`, keeping this task's files disjoint from task 4.
   - Drive it entirely off the registry; never hardcode an action list. Read availability from `useOptionalVoice()` and offer nothing when voice is off.
   - Verify: `cd web && pnpm vitest run src/components/voice/voice-help-entries.test.ts` — assert that adding a registry action changes the rendered entries with no edit to the help component.

**Parallelizable:** tasks 1 and 2 are independent and can run concurrently. 3 depends on 2, 4 on 3, 5 on 4. The chain is longer than the old TG2's because the wake word sits underneath everything that follows.

### Completion Summary

_Partial — TG2 is implemented and awaiting the user's own testing._

**Wake word: the user says "Angie"; the spotter listens for `ANGIE` and `NG`.** "Engy" is unusable — it encodes to three short pieces (`▁E NG Y`) and scored 0/48, so the spoken name diverges deliberately from the product name. The spotter matches token sequences, so the two are free to differ.

**The denominator matters more than any tuning knob.** Of 99 recordings captured after the wake word shipped, 19 contain no wake word at all — VAD fragments like "Mm", "Yeah", empty 0.0s clips. Scoring against 99 understated recall by 13 points. The real denominator is **80 wake attempts**, confirmed by transcribing every clip and reading the 18 that fired without an obvious wake word in their transcript: all 18 are the ASR mangling a real attempt ("Okay, and G", "Ok Eng", "Ngi", "PNG", "Hengie", "An engine"). None is a false accept.

**Measured on those 80 real wake attempts, with 70 wake-free recordings as negatives** (FR-TG2.11's "measure before tuning" requirement), at `keywordsThreshold: 0.01` with the close-flush in place:

| Registered keywords | score | Recall | False accepts |
|---|---|---|---|
| ANGIE + OKAY ANGIE | 3.0 | 46/80 (58%) | 0/70 |
| NG + ANGIE | 3.0 | 73/80 (91%) | 0/70 |
| **NG + ANGIE (shipped)** | **4.0** | **75/80 (94%)** | **0/70** |
| NG + ANGIE | 5.0 | 76/80 (95%) | 1/70 |
| NG alone | 4.0 | 68/80 (85%) | 0/70 |
| NG + ANGIE + ANG | 4.0 | 73/80 (91%) | 0/70 |

Score 5.0 buys one more accept and costs the first false accept, so 4.0 is the edge of the free range.

Three findings worth carrying forward:

- **Register what the model hears, not what the user says.** Both models render a spoken "Angie" as "NG". Registering that fragment was the single largest gain in this milestone. Spelling variants that read plausibly to a human (`ANGY`, `ENGIE`) gained almost nothing, because they are not what the acoustic model produces.
- **The spotter needs audio after the keyword.** Detections land 0.8–2.1s into a clip, so a turn ending on the word ends before the detection emits. Feeding 0.5s of silence on close recovers those; the gain plateaus at 0.5s.
- **Fewer registered keywords detect better.** Four keywords measured 27% where two measured 48% on identical audio. The spotter appears to divide decoding across keywords, so each added variant costs the others. This is why the spot list is minimal while a separate, wider `WAKE_PREFIXES` list handles stripping — text stripping has no detection cost.
- **Synthesized audio is void for tuning this model.** A full TTS sweep scored zero on every phrase including the model's own shipped `GO HOME` control, which measures 89% on real speech. Only real recordings were used.

**Open: `NG` is two tokens, short enough to be a false-accept risk in principle** ("going", "thing", "running"). It measured 0/70 here, and in push-to-talk a false wake is cheap — the segment resolves as a command and shows "No matching action" instead of being typed. Re-measure before TG3's always-on, where nothing else gates the mic.

**Open: the remaining 5 misses are wake-word-only utterances** — "Okay, Angie." with nothing after it, 1.3–2.4s long. Nothing in the operating grid recovers them, which fits the same cause as the close-flush: too little audio for the model to commit. Saying the command in the same breath is what avoids them, and is what the help text should say.

## TG3: Always-On Session, Modes & Safety

Turns the wake word into a session you can leave running, adds the dictation sub-mode, persists what is configurable, and makes the phone path usable. Sequenced last because always-on is only safe once the registry can reject low-confidence input and the spotter can reject unaddressed speech.

Replanned after TG1. Two of the original TG3 tasks already shipped: `voiceEnabled` plus its migration, and the mobile control (a mic key in `terminal/mobile-terminal-controls.tsx`). What remains of those is `voiceConfig` and the secure-context banner.

### The safety rule this group exists to hold

Always-on plus terminal input is the risky combination in this milestone. The rule is that **unaddressed speech is discarded, never dictated**. Speech reaches a terminal only when it carries the wake word, or when dictation mode was explicitly entered by a wake-word command. A mode where the machine listens and types without being addressed turns a phone call in the same room into terminal input, and is not built.

### Requirements

1. The system shall support an always-on session mode in addition to push-to-talk, with push-to-talk as the default. *(source: user request — "ideal if voice mode is just on")* (FR-TG3.1)
2. *(Retired. Originally required segmenting open-mic utterances with the recognizer's built-in endpointing and named `rule2MinTrailingSilence`. That is an `OnlineRecognizer` API, and TG1 ships an `OfflineRecognizer` with Silero VAD after the streaming model was rejected on accuracy. Segmentation is covered by the VAD path TG1 already built.)*
3. The system shall close an always-on session on an explicit user action or after an idle timeout. *(inferred: an indefinitely open mic is a privacy and battery problem)* (FR-TG3.3)
4. The system shall persist voice preferences per workspace. *(inferred: follows `containerEnabled`/`containerConfig` precedent)* (FR-TG3.4)
5. The system shall warn the user when the page is not a secure context, and explain how to reach one. *(inferred, and confirmed during TG1: `http://100.x.x.x` over Tailscale is not a secure context, so `getUserMedia` refuses; reaching one needs HTTPS or a browser origin allowlist)* (FR-TG3.5)
6. The system shall gate first microphone activation behind a real user gesture. *(inferred: iOS Safari requirement, confirmed in crouton's `bridge-client.ts`, and hit during TG1 when awaiting the permission prompt consumed the activation)* (FR-TG3.6)
7. The system shall enter and leave dictation mode by voice command, and shall route every speech segment to the terminal while it is active. *(source: user request — "send inputs to terminals" without holding a key)* (FR-TG3.7)
8. The system shall recognize a wake-word command while dictation mode is active, and shall treat it as a command rather than dictated text. *(inferred from FR-TG3.7: a dictation mode with no spoken exit can only be left by hand, which defeats it)* (FR-TG3.8)
9. The system shall never append a submit character to voice-inserted terminal text, in any mode. *(source: user request in TG1 — never auto-submit into a live agent terminal; always-on raises the cost of breaking this from a stray line to an executed one)* (FR-TG3.9)
10. The system shall show, whenever the microphone is open, that it is open and in which mode. *(inferred: an always-on mic the user cannot see is the privacy failure FR-TG3.3 only partly addresses)* (FR-TG3.10)

### Tasks

1. **Always-on session lifecycle in `web/`**
   - Files: `web/src/components/voice/use-voice-capture.ts` [MODIFY], `web/src/components/voice/session-mode.ts` [NEW], `web/src/components/voice/session-mode.test.ts` [NEW]
   - Implements FR-TG3.1, FR-TG3.3, FR-TG3.10
   - A session holds the mic open and streams continuously; the spotter decides what gets decoded. Push-to-talk stays the default and keeps its existing behaviour.
   - The input-state machine now has two entry paths. Keep the audio path identical between them so only the framing differs — TG1's controller already separates "holding" from "turn in flight", and that seam is where this belongs.
   - Idle timeout and explicit close both end the session and release the mic. Releasing matters beyond tidiness: TG1 releases at key-up specifically so the OS microphone indicator clears.
   - Verify: `cd web && pnpm vitest run src/components/voice/session-mode.test.ts`

2. **Dictation sub-mode in `web/`** (depends on task 1)
   - Files: `web/src/lib/voice/actions/dictation.ts` [NEW], `web/src/lib/voice/actions/dictation.test.ts` [NEW], `web/src/components/voice/use-voice-capture.ts` [MODIFY]
   - Implements FR-TG3.7, FR-TG3.8, FR-TG3.9
   - Register "dictate" and "stop dictating" as wake-word commands. While active, every decoded segment is inserted into the focused terminal; a segment that carries the wake word is resolved as a command instead, which is what makes "Angie, stop dictating" work.
   - Insertion reuses TG1's `insertToTerminal` path, which never appends `\r`. Add a test that asserts the absence of the submit character rather than trusting it — FR-TG3.9 is the one requirement here whose breach is not reversible.
   - Verify: `cd web && pnpm vitest run src/lib/voice/actions/dictation.test.ts`

3. **Workspace voice settings in `web/`** (depends on task 1)
   - Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/db/migrations/` [NEW], `web/src/components/workspace/voice-settings.tsx` [NEW], `web/src/server/trpc/routers/workspace.ts` [MODIFY]
   - Implements FR-TG3.4
   - Add `voiceConfig` JSON beside the `voiceEnabled` boolean TG1 already shipped, mirroring `containerConfig`. It carries mode (ptt / always-on), wake word, spotter threshold, PTT keybinding, and idle timeout. Do **not** re-add `voiceEnabled` or its migration.
   - Changing the wake word re-encodes the keywords file, so treat it as invalidating cached spotter config rather than a plain settings write.
   - Run `cd web && pnpm drizzle-kit generate` after the schema change.
   - Verify: `cd web && pnpm vitest run src/server/trpc/routers/workspace.test.ts`

4. **Secure-context banner in `web/`** (depends on task 1)
   - Files: `web/src/components/voice/secure-context-banner.tsx` [NEW — adapt from crouton]
   - Implements FR-TG3.5, FR-TG3.6
   - Explain the actual remedies found during TG1, not a generic "needs HTTPS": either an HTTPS origin (`tailscale serve`, which requires enabling tailnet HTTPS certificates and publishes device names to public Certificate Transparency logs) or the browser's insecure-origin allowlist, which stores a full origin including the port.
   - Do not modify `terminal/mobile-terminal-controls.tsx`; TG1 already added the mic key there.
   - Verify: `pnpm exec playwright-cli` against a non-secure origin.

**Parallelizable:** tasks 2, 3 and 4 all depend only on task 1 and own disjoint files.

### Completion Summary

_Blank until TG3 completes._

## Out of Scope

- TTS and agent voice responses (agents speaking back on `waiting`/`done` activity transitions, MCP `speak` tool, per-terminal voice assignment) — deferred to a future milestone. Measured on this hardware: Kokoro-82M is unusable on CPU (RTF ~0.7–1.3), Piper `en_US-amy-low` is viable (RTF 0.078, 115 ms for a 1.5 s utterance).
- Wake word / always-on listening.
- Barge-in and echo-cancellation tuning (only matters once TTS exists).
- Refactoring `global-search.tsx` onto the action registry.
- LLM fallback tier for unmatched utterances.
- Multi-language support.
