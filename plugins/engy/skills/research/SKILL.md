---
name: engy:research
description: Search the knowledge layer for prior decisions, patterns, facts, and conventions on a topic. Use when the user asks "what do we know about X?".
---

# Knowledge Research

Dispatch the `engy:research` subagent to search the workspace knowledge graph and return a curated digest of relevant findings.

## Process

### Step 1: Resolve Context

Identify scope hints from the current session:
- Active project name or slug
- Active milestone ref (e.g., "m7")
- Repo path if the question is repo-local

### Step 2: Dispatch Research Subagent

Invoke the `engy:research` subagent via the Task tool:

```
Task({
  subagent_type: 'engy:research',
  prompt: '<user question> — context: <active project/milestone/repo>'
})
```

Include any scope hints in the prompt so the subagent can apply `filters.repo`, `filters.scenarioIds`, or collection scoping when relevant.

### Step 3: Present Results

Print the returned digest to the user verbatim. Do not summarize or reformat — the subagent's output is already structured for direct consumption.

## Output Format

The subagent returns a `## Findings` block with 3–8 cited findings and a sources/findings count footer. Present it as-is.

If the user's question is ambiguous, ask one clarifying question before dispatching (e.g., "Is this about the current project or workspace-wide?").

## Key Principles

- Dispatch-only — this skill does no work beyond invoking the subagent.
- Present the digest verbatim — the subagent's structured output is already formatted for the user.
- Ask one clarifying question if the user's input is ambiguous (e.g., "is this workspace-wide or project-scoped?").

## Flow Position

**Typical trigger:** user asks "what do we know about X?" in the terminal.

**Next step:** user uses the digest to inform their next action — write a plan, design a feature, file a bug.
