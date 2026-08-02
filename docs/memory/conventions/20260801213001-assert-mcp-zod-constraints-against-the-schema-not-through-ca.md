---
subtype: convention
title: 'Assert MCP zod constraints against the schema, not through callTool'
keywords:
  - callTool
  - inputSchema
  - safeParse
  - zod
  - MCP test harness
  - isError
themes:
  - testing
  - mcp
tags:
  - testing
  - mcp
sources: []
linkedMemories:
  - >-
    memory/insights/20260623233026-web-src-server-ws-tests-bind-real-sockets-run-with-bash-sand.md
  - >-
    memory/conventions/20260801212900-verify-a-regression-test-fails-for-the-reason-you-think-not-.md
  - >-
    memory/insights/20260623233118-web-ws-search-test-suites-flake-under-blt-need-isolated-engy.md
  - >-
    memory/facts/20260801213252-execution-and-terminal-session-ids-are-separate-namespaces-t.md
scenarioIds: []
---
**Rule:** To test a zod-only constraint on an MCP tool (e.g. `content.min(1)`), assert the schema directly — `tools.<name>.inputSchema.safeParse({...})` with `success === false`. Calling the tool and asserting `isError` can never verify it.

**Why:** the MCP test harness's `callTool()` helper deliberately falls through to RAW unvalidated params when `inputSchema.safeParse` fails, so that handler-only error-path tests keep working. The handler therefore runs happily with invalid params.

**Evidence:** tool-call-level assertions look like they cover schema constraints but silently do not. Only schemas backed by handler-side runtime checks are actually exercised via `callTool`.
