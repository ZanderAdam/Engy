---
subtype: pattern
title: Browser-only terminal WS messages are typed but excluded from relay unions
keywords:
  - TerminalPingCmd
  - TerminalPongEvent
  - TerminalTitleMsg
  - TerminalRelayCommand
  - protocol.ts
  - wake probe
  - heartbeat
themes:
  - websocket
  - terminal
  - protocol
tags:
  - terminal
  - architecture
sources: []
linkedMemories: []
scenarioIds: []
---
**Rule:** A browser-leg terminal WS message that terminates at the server follows one pattern: type it in `common/src/ws/protocol.ts` for the shared contract, exclude it from the daemon-facing `TerminalRelayCommand`/`TerminalRelayEvent` unions, and intercept it by string prefix before the generic daemon forward.

**Why:** these messages never reach the daemon, so putting them in the relay unions would misrepresent the protocol. The server matches `str.startsWith('{"t":"ping"')` ahead of the forward and answers pong with no daemon round-trip.

**Connects to:** the wake probe replaced force-close-on-visibilitychange — `ReconnectingSocket` now force-reconnects an OPEN socket only when a 3s ping probe times out, which is what stops the xterm clear+replay churn on every tab switch. The daemon↔server legs keep their own separate 30s protocol-level heartbeat in `client/src/ws/client.ts`; two independent liveness mechanisms, do not conflate them.
