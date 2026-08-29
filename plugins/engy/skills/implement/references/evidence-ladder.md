# Evidence ladder and verdicts

How to grade a claim that work is done or correct. Used by `/engy:implement`,
`/engy:implement-milestone`, and `/engy:review`.

An agent's own confidence is not evidence, and prose describing why something works reads as
convincing whether or not it is true. Grading the claim instead of the prose is what stops that.

## Rungs

1. You asserted it.
2. You cited a real `file:line`.
3. You walked the failure path and it cannot reach.
4. You ran code on the real path that fails loud if you are wrong.
5. You reproduced it in the running app, on the surface a user touches.

Push each claim as far as is cheap, then say where it stopped. Rung 4 is usually one focused test
against the module the app actually ships — cheaper than the paragraph explaining why you skipped
it. Below rung 4, write **unproven** and mean it.

The project's validation gate is rung 4 for the behaviour its tests cover and rung 1 for everything
else, so "the build is green" is not evidence that a feature works. Anything a user sees needs rung
5, driven on the real surface — a browser, the CLI, the API — because a passing build says nothing
about what they get.

## Verdicts

Each verification ends in one of three values, never an implied pass:

- **VERIFIED** — checked at rung 4 or 5. Name the rung and the artifact.
- **NOT VERIFIED** — checked and it failed. Include the output.
- **INCONCLUSIVE** — did not run, ran on the wrong surface, or cannot be trusted. Say what blocked
  it and what would settle it.

Inconclusive is not a pass. When a check passes suspiciously easily, suspect the observation method
first — a blank screenshot satisfies a lazy gate.

```
VERIFIED (rung 5) — an edited draft survives a page reload
  artifacts/draft-reload.png

VERIFIED (rung 4) — expired tokens are rejected
  src/auth/session.test.ts:88

INCONCLUSIVE — the retry backs off when the upstream is down
  blocked: no way to fail the upstream from this environment
  settles it: point the client at a stub that returns 503
```
