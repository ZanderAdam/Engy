---
title: Voice Navigation & Input
status: draft
---

# Plan: M13 Voice Navigation & Input

## Overview

M13 adds voice as a second input head to Engy: speech-to-text dictation into terminal sessions, and spoken navigation across and within projects. Audio is captured in the browser, streamed over a dedicated WebSocket to the server, and transcribed in-process by a local streaming ASR model. Recognized text either dispatches a navigation action or is staged into a terminal for the user to send. Nothing leaves the machine.

**TG1 is a go/no-go gate.** It builds the thinnest possible end-to-end path — hold a key, speak, see text land in the focused terminal — and stops. If dictation into a live agent terminal does not feel worth the friction, M13 ends there and TG2/TG3 are dropped. TG1 is deliberately under-built: no action registry, no HUD chrome, no settings, no persistence. Do not gold-plate it; its only job is to answer the question.

Boundary: no TTS, no agent voice responses, no wake word, no barge-in, no speaker identification, no multi-language support, no per-terminal voice assignment, no changes to the existing cmdk palette.

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
| parakeet-tdt-0.6b int8 (offline) | RTF 0.184; correct punctuation and casing |

No GPU needed. The npm package `sherpa-onnx` is the single-threaded WASM build — the native multithreaded addon is `sherpa-onnx-node`. No GPU variant is published to npm (`sherpa-onnx-linux-x64-gpu` 404s); CUDA requires a source build. `OnlineRecognizer` ships built-in endpointing (`enableEndpoint`, `rule1/2/3MinTrailingSilence`) and hotword biasing (`hotwordsFile`, `hotwordsScore`).

## Task Group Sequencing

- **TG1: Dictation MVP (gated)** — no dependencies. Can start immediately. **Ends in an explicit go/no-go decision.**
- **TG2: Voice Navigation** — depends on TG1 passing its gate (reuses the capture path, `/ws/voice` transport, and recognizer wrapper wholesale).
- **TG3: Modes, Settings & Mobile** — depends on TG2 (needs the action registry to gate open-mic commands against, and navigation to have a settings surface worth building).

If TG1's gate fails, TG2 and TG3 are dropped and the milestone closes.

## TG1: Dictation MVP (gated)

The thinnest end-to-end slice that answers "is voice input into a terminal worth building?" Hold a key, speak, release; transcribed text appears in the focused terminal's input, unsent. Nothing else. Three tasks, deliberately minimal — no action registry, no navigation, no settings, no persistence, no open-mic, no mobile affordance.

**Explicitly out of scope for TG1, even if tempting:** transcript HUD styling, confidence display, undo, per-terminal targeting, punctuation restoration, model choice UI, reconnect/backoff hardening.

### Requirements

1. The system shall stream 16 kHz s16le mono PCM from the browser to the server over a dedicated `/ws/voice` WebSocket while a push-to-talk key is held. *(source: user request)* (FR-TG1.1)
2. The system shall transcribe streamed audio in-process using a local streaming ASR model, with no network egress. *(source: user request)* (FR-TG1.2)
3. The system shall download and cache ASR model assets under `ENGY_DIR` on first use, and shall not commit model binaries to the repository. *(inferred: 130 MB+ assets, no vendoring precedent exists)* (FR-TG1.3)
4. The system shall emit interim transcripts during speech and one final transcript when the key is released. *(inferred: required for usable feedback)* (FR-TG1.4)
5. The system shall insert the final transcript into the focused terminal without submitting it. *(source: user request — never auto-submit into a live agent terminal)* (FR-TG1.5)
6. The system shall degrade with a visible error, not a silent failure, when the page is not a secure context or the mic is denied. *(inferred: Tailscale/mobile access makes this a real path)* (FR-TG1.6)

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

_Blank until TG1 completes._

## TG2: Voice Navigation

Adds the action registry and spoken navigation. Reuses TG1's capture path, transport, and recognizer without modification. `global-search.tsx` is not touched — the registry is a new, voice-only consumer, and navigation actions are defined in it independently of the existing palette.

### Requirements

1. The system shall maintain an action registry of typed, named actions with speakable phrase templates and typed parameters. *(source: user request)* (FR-TG2.1)
2. The system shall build its recognition vocabulary from live application state — open projects, tab names, and terminal sessions — at recognition time. *(inferred: names change at runtime)* (FR-TG2.2)
3. The system shall resolve a transcript to an action by exact phrase match, then by phonetic fuzzy match, and shall reject rather than guess below a confidence threshold. *(inferred: STT mangles slugs; a wrong navigation is cheap but a wrong dispatch is not)* (FR-TG2.3)
4. The system shall navigate to a named project or tab using `navigateOrReuseTab`. *(inferred: bypassing it causes duplicate tabs)* (FR-TG2.4)
5. The system shall resolve terminal references by ordinal or label against the server session registry, not the browser session store. *(inferred: browser store drops unmounted projects)* (FR-TG2.5)
6. The system shall focus a voice-selected terminal by emitting the existing `{t:'ack', sessionId}` signal. *(inferred: FR-TERMINAL-240 already owns this path)* (FR-TG2.6)
7. The system shall display the recognized transcript, the matched action, and the match confidence before or as it acts. *(source: user request — feedback loop is what makes command voice usable)* (FR-TG2.7)
8. The system shall provide a help surface listing every registered voice action and its phrase templates, derived from the action registry rather than a maintained list. *(source: user request)* (FR-TG2.8)
9. The help surface shall show the live vocabulary — current project, tab, and terminal names — resolved into example phrases the user can actually say. *(inferred: a template like "select project &lt;name&gt;" is not actionable without knowing the valid names)* (FR-TG2.9)
10. The help surface shall be reachable by voice as well as by keyboard. *(inferred: a hands-free feature whose discovery requires the keyboard defeats itself)* (FR-TG2.10)

### Tasks

1. **Action registry core + phonetic resolver**
   - Files: `web/src/lib/voice/registry.ts` [NEW], `web/src/lib/voice/resolve.ts` [NEW], `web/src/lib/voice/resolve.test.ts` [NEW], `web/src/lib/voice/phonetic.ts` [NEW], `web/src/lib/voice/phonetic.test.ts` [NEW]
   - Implements FR-TG2.1, FR-TG2.3
   - `{ id, title, phrases[], params, run(ctx) }`. Double Metaphone + edit distance for tier 2. Pure functions, no React, no I/O — this is the most testable part of the milestone and should carry the densest unit tests. Table-test against real STT mangles of your actual project slugs (e.g. `engy-web` → "engie web", "n g web", "energy web").
   - Verify: `cd web && pnpm vitest run src/lib/voice/`

2. **Live vocabulary + hotword biasing** (depends on task 1)
   - Files: `web/src/components/voice/use-voice-vocabulary.ts` [NEW], `web/src/components/voice/use-voice-vocabulary.test.ts` [NEW], `web/src/server/voice/recognizer.ts` [MODIFY]
   - Implements FR-TG2.2, FR-TG2.5
   - Assemble projects/tabs/terminals into a vocabulary. Terminals come from `GET /api/terminal/sessions?all=1`, never `terminal-session-store.ts`. Push the vocabulary to the recognizer as `hotwordsFile`/`hotwordsScore` so biasing happens at the ASR layer as well as in fuzzy matching.
   - Verify: `cd web && pnpm vitest run src/components/voice/use-voice-vocabulary.test.ts` — assert terminals from an unmounted project still appear.

3. **Navigation + terminal-focus actions** (depends on task 2)
   - Files: `web/src/lib/voice/actions/navigation.ts` [NEW], `web/src/lib/voice/actions/terminal.ts` [NEW], `web/src/lib/voice/actions/navigation.test.ts` [NEW], `web/src/components/voice/voice-indicator.tsx` [MODIFY]
   - Implements FR-TG2.4, FR-TG2.6, FR-TG2.7
   - Register "select project X", "open tab Y", "focus terminal N". Navigation goes through `navigateOrReuseTab` (`web/src/components/tabs/tab-state.ts`); focus emits `{t:'ack', sessionId}`. Extend the indicator to show transcript + matched action + confidence. If M13 later adds a project-section tab, remember a new tab type needs three wiring points — the `sections.ts` registry entry, the route `page.tsx`, **and** a `case` in `dispatchProject` (`web/src/components/tabs/tab-content.tsx`); omitting the third compiles clean and silently renders NotFound.
   - Verify: `cd web && pnpm vitest run src/lib/voice/actions/`, then `pnpm blt`, then `pnpm exec playwright-cli` to confirm no duplicate tabs.

4. **Voice help surface** (depends on task 2)
   - Files: `web/src/components/voice/voice-help-dialog.tsx` [NEW], `web/src/components/voice/voice-help-entries.ts` [NEW], `web/src/components/voice/voice-help-entries.test.ts` [NEW], `web/src/lib/voice/actions/help.ts` [NEW]
   - Implements FR-TG2.8, FR-TG2.9, FR-TG2.10
   - A dialog (reuse `components/ui/dialog`) that enumerates every action in the registry, grouped by category, showing each phrase template. `voice-help-entries.ts` is the pure part: it takes the registry plus the live vocabulary from `use-voice-vocabulary.ts` and expands templates into concrete example phrases — `select project <name>` renders as the actual project names currently open, capped at a few per action with a "+N more" affordance. Unmatched-parameter actions fall back to showing the bare template.
   - Register a `voice.help` action in `actions/help.ts` with phrases like "what can I say", "show voice help", "help" — so the help surface is itself voice-reachable. Own the keyboard trigger inside `voice-help-dialog.tsx` (bail via `isTypingTarget()`), **not** in `voice-indicator.tsx` — this keeps the task's files disjoint from task 3 so the two can run concurrently.
   - The dialog must render correctly when the registry contains actions this task did not write, since task 3 adds actions in parallel. Drive it entirely off the registry; never hardcode an action list.
   - Verify: `cd web && pnpm vitest run src/components/voice/voice-help-entries.test.ts` — assert that adding an action to the registry changes the rendered entries with no edit to the help component, and that a template with no live vocabulary values degrades to the bare template.

**Parallelizable:** tasks 3 and 4 both depend only on task 2 and own disjoint files — they can run concurrently. Tasks 1 → 2 are strictly sequential.

### Completion Summary

_Blank until TG2 completes._

## TG3: Modes, Settings & Mobile

Adds the open-mic session mode alongside PTT, persists preferences, and makes the phone path usable. Sequenced last because open-mic is only safe once the registry can reject low-confidence input, and settings are only worth a surface once there is something to configure.

### Requirements

1. The system shall support a session-scoped open-mic mode in addition to push-to-talk, with push-to-talk as the default. *(source: user request)* (FR-TG3.1)
2. The system shall segment utterances in open-mic mode using the recognizer's built-in endpointing. *(inferred: `rule2MinTrailingSilence` already exists; a separate turn-detector model is unnecessary)* (FR-TG3.2)
3. The system shall close an open-mic session on an explicit user action or after an idle timeout. *(inferred: an indefinitely open mic is a privacy and battery problem)* (FR-TG3.3)
4. The system shall persist voice preferences per workspace. *(inferred: follows `containerEnabled`/`containerConfig` precedent)* (FR-TG3.4)
5. The system shall warn the user when the page is not a secure context, and explain how to reach one. *(inferred: `http://100.x.x.x` over Tailscale is NOT a secure context — only the `*.ts.net` hostname is)* (FR-TG3.5)
6. The system shall gate first microphone activation behind a real user gesture. *(inferred: iOS Safari requirement, confirmed in crouton's `bridge-client.ts`)* (FR-TG3.6)

### Tasks

1. **Open-mic session mode**
   - Files: `web/src/components/voice/use-voice-capture.ts` [MODIFY], `web/src/components/voice/session-mode.ts` [NEW], `web/src/components/voice/session-mode.test.ts` [NEW], `web/src/server/voice/recognizer.ts` [MODIFY]
   - Implements FR-TG3.1, FR-TG3.2, FR-TG3.3
   - Tap to open a session; the recognizer's endpointing segments utterances until the user closes it or an idle timeout fires. PTT remains the default. Note the input-state machine now has two entry paths — keep the audio path identical between them so only the framing differs.
   - Verify: `cd web && pnpm vitest run src/components/voice/session-mode.test.ts`

2. **Workspace voice settings** (depends on task 1)
   - Files: `web/src/server/db/schema.ts` [MODIFY], `web/src/server/db/migrations/` [NEW], `web/src/components/workspace/voice-settings.tsx` [NEW], `web/src/server/trpc/routers/workspace.ts` [MODIFY]
   - Implements FR-TG3.4
   - `voiceEnabled` boolean + `voiceConfig` JSON, mirroring `containerEnabled`/`containerConfig`. Config carries mode (ptt/open-mic), PTT keybinding, model choice, and idle timeout. Run `cd web && pnpm drizzle-kit generate` after the schema change.
   - Verify: `cd web && pnpm vitest run src/server/trpc/routers/workspace.test.ts`

3. **Secure-context banner + mobile control** (depends on task 1)
   - Files: `web/src/components/voice/secure-context-banner.tsx` [NEW — adapt from crouton], `web/src/components/terminal/mobile-terminal-controls.tsx` [MODIFY]
   - Implements FR-TG3.5, FR-TG3.6
   - Adapt crouton's banner, rewording guidance for Engy: desktop uses `http://localhost` (already a secure context); phone must use the Tailscale `*.ts.net` hostname, not the `100.x.x.x` IP. Add the PTT control to the mobile terminal controls, gated behind a real tap for iOS.
   - Verify: `pnpm blt`, then manual over Tailscale on the phone.

**Parallelizable:** tasks 2 and 3 both depend only on task 1 and touch disjoint files — they can run concurrently.

### Completion Summary

_Blank until TG3 completes._

## Prerequisites (not code tasks)

- Phone access must use the Tailscale `*.ts.net` hostname. `http://100.x.x.x` is not a secure context and `getUserMedia` will silently refuse. Tailscale terminates TLS in front of the plain-HTTP server; Engy needs no cert handling of its own. Crouton documents this at `crouton/README.md:31-37`.
- Desktop over `http://localhost:<port>` is already a secure context. No action needed.

## Known Risks

- **20M-model accuracy on real mic input is unmeasured.** The benchmark used a clean studio clip. If WER is poor, swap to a larger streaming zipformer or accept parakeet's higher latency — TG1's recognizer wrapper isolates this choice to one file.
- **Terminal identity is documented as fragile** — open tickets cover status indicators, reconnect after sleep, remembering the terminal tab across refresh, and cross-browser sessions. "Focus terminal 2" inherits whatever is wrong there. Reading the server registry (FR-TG2.5) is the mitigation, not a fix.
- **Model asset handling is unprecedented in this repo.** TG1 task 1 sets the pattern for every future local model; get the `ENGY_DIR` caching and `.gitignore` treatment right the first time.
- **The search index was empty when this milestone was researched** (129 files on disk, 0 indexed) and was repopulated during planning. 201 embeddings remain pending, so vector/hybrid search stays degraded until an embed pass runs. Separately, the `projects` collection reports stale paths for several completed milestone plans — worth a targeted reindex.

## Out of Scope

- TTS and agent voice responses (agents speaking back on `waiting`/`done` activity transitions, MCP `speak` tool, per-terminal voice assignment) — deferred to a future milestone. Measured on this hardware: Kokoro-82M is unusable on CPU (RTF ~0.7–1.3), Piper `en_US-amy-low` is viable (RTF 0.078, 115 ms for a 1.5 s utterance).
- Wake word / always-on listening.
- Barge-in and echo-cancellation tuning (only matters once TTS exists).
- Refactoring `global-search.tsx` onto the action registry.
- LLM fallback tier for unmatched utterances.
- Multi-language support.
