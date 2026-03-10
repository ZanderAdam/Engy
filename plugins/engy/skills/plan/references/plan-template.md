# Plan: [Feature/Change Name]

## Overview
One paragraph: what we're building, why, and the scope boundary.

## Codebase Context
Key conventions, patterns, and existing infrastructure discovered during
the Internal Pass. Include file paths. Keep brief — just what's needed
to inform implementation.

## Affected Components
List each file/module/service that will be created or modified and what changes.

## Functional Requirements
Numbered list. Each requirement is one clear behavior the system must exhibit.
Use "The system shall..." or "When [trigger], [behavior]" format.
Tag each with its source: (user request), (inferred: <source>), (elicited).
Group by feature area if more than 5.

## Non-Functional Requirements
Only include what's relevant: performance targets, security constraints,
accessibility, compatibility, data handling, error recovery.

## Workflow
Step-by-step happy path. Include what the user sees/does at each step.
Note where error/edge case handling branches off (don't detail every branch).

## Out of Scope
Explicit list of what this work does NOT include, to prevent scope creep.

## Implementation Sequence
Ordered list of implementation steps. Each step should be independently
testable or verifiable. Flag any step that depends on another.

## Open Questions
Anything still ambiguous after elicitation that the user should weigh in on
before implementation starts.
