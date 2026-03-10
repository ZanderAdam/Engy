# Validation Checklist Reference

Detailed checklist for validating project documents against their source specs. Use this as a systematic guide — not every category applies to every document.

## 1. Data Model Alignment

- [ ] All entities mentioned in spec have corresponding structures in the document
- [ ] All fields/columns match spec definitions (names, types, nullability, defaults)
- [ ] Foreign key relationships match spec's entity relationships
- [ ] New fields are justified by spec requirements (no goldplating)
- [ ] Existing schema is reused where spec references existing entities
- [ ] Migration strategy is specified for schema changes

## 2. Lifecycle & State Machines

- [ ] Every entity lifecycle in the spec is fully represented
- [ ] All states are present (none dropped or renamed without justification)
- [ ] All valid transitions are documented
- [ ] Invalid transitions are blocked or noted
- [ ] Transition guards/preconditions match spec (e.g., "all tasks done before Ready")
- [ ] Terminal states are correctly identified
- [ ] Transitions triggered by external events (e.g., project creation sets spec to Active) are noted, even if implemented in a later milestone

## 3. API Surface

- [ ] All CRUD operations required by spec are present
- [ ] Input schemas match spec requirements (required vs optional fields)
- [ ] Output shapes contain the data the spec says should be available
- [ ] Filtering/scoping parameters align with spec's query patterns
- [ ] Error cases from spec are handled (validation, not-found, authorization)
- [ ] API follows existing codebase conventions (naming, structure, error format)

## 4. Infrastructure Consistency

### Existing Patterns
- [ ] Uses existing database tables/columns rather than creating parallel structures
- [ ] Follows established tRPC router conventions (input validation, error handling)
- [ ] Follows existing MCP tool patterns (naming, parameter shapes, helpers)
- [ ] Reuses existing test setup utilities (setupTestDb, temp dirs, cleanup)
- [ ] Reuses existing UI components where applicable (buttons, dialogs, trees)
- [ ] Reuses existing code patterns and abstractions

### Communication
- [ ] Uses existing WebSocket message types where applicable
- [ ] Doesn't duplicate functionality already provided by another layer (e.g., daemon file watching vs server-side watchers)
- [ ] New message types follow established protocol patterns

### Dependencies
- [ ] New packages are justified (no existing package covers the need)
- [ ] Version compatibility with existing stack considered
- [ ] Package choices align with spec recommendations (e.g., spec says "BlockNote" → use BlockNote)

## 5. UI/UX Requirements

- [ ] Layout matches spec's design description (panels, sizing, responsiveness)
- [ ] Navigation patterns follow spec conventions
- [ ] All interactive elements specified in spec are present (buttons, dialogs, trees)
- [ ] Empty states are handled
- [ ] Loading states are considered
- [ ] Error states surface useful information
- [ ] IDE integration points are present ("Open in VS Code" wherever file paths appear)
- [ ] Visual differentiation for distinct entity types (e.g., vision vs buildable specs)
- [ ] Action placement follows spec's UI conventions (e.g., top-right action bar)

## 6. Security & Validation

- [ ] Path traversal prevention for filesystem operations
- [ ] Input validation on user-provided data
- [ ] Scoping enforcement (workspace-level isolation, ownership checks)
- [ ] Immutability constraints are enforced (not just documented)
- [ ] No mutation endpoints that bypass stated constraints

## 7. Scoping & Boundaries

- [ ] Document's stated scope matches what it actually covers
- [ ] Out-of-scope items match the spec's milestone phasing
- [ ] No features from future milestones are implemented
- [ ] Deferred items are genuinely deferrable (the delivered feature works without them)
- [ ] Dependencies on future milestones are noted explicitly
- [ ] Disabled/placeholder UI for future features is noted (e.g., "Create Project" button disabled until M3)

## 8. Testing Strategy

- [ ] Test scope matches implementation scope
- [ ] Test approach follows existing patterns (integration vs unit, mocking strategy)
- [ ] Coverage targets are specified if the project has standards
- [ ] Edge cases from spec requirements are covered (lifecycle transitions, error paths, empty states)

## 9. Implementation Sequence

- [ ] Steps are ordered by dependency (no forward references)
- [ ] Each step is independently verifiable
- [ ] Cross-cutting concerns (schema migrations, package installs) come before dependent work
- [ ] Integration points between steps are clear
- [ ] No circular dependencies between phases

## 10. Spec-Document Traceability

For high-confidence validation, trace each functional requirement in the document back to a spec source:

| Document FR | Spec Source | Status |
|-------------|------------|--------|
| FR #N | Spec section X, line Y | Covered / Partial / Gap |

This table is optional but valuable for complex documents with 20+ requirements.
