# SRS Validation Checklist

Systematic checklist for validating a Software Requirements Specification against its source documents (vision doc, context files, milestones). Not every category applies to every spec — skip what is irrelevant.

## 1. Template Compliance

- [ ] All numbered sections from the spec template are present
- [ ] No empty sections (each has substantive content or is explicitly marked N/A)
- [ ] Frontmatter present with title, status, and type fields
- [ ] Section numbering is sequential with no gaps
- [ ] Revision history has at least one entry
- [ ] References table links to all source documents in the spec directory

## 2. Definition Completeness

- [ ] Every domain-specific term used in FRs appears in the definitions table
- [ ] Every technology/tool referenced by name has a definition (e.g., ChromaDB, Mastra)
- [ ] No definitions are orphaned (defined but never referenced)
- [ ] Definitions are accurate — match usage in the source docs
- [ ] Abbreviations are expanded in definitions (e.g., SDD, MCP, FR, NFR)

## 3. FR Completeness (Cross-Reference Against Source Docs)

For each source document (vision doc, each context file):
- [ ] Read the source doc paragraph by paragraph
- [ ] For each described behavior, feature, or capability: verify a corresponding FR exists
- [ ] For each entity lifecycle: verify all states and transitions are captured in FRs
- [ ] For each user interaction described: verify a stimulus/response entry and FR exist
- [ ] For each architectural decision: verify it is reflected in constraints, assumptions, or FRs
- [ ] For each error handling behavior: verify an FR or NFR covers it

Common gaps to watch for:
- Inheritance/template behaviors (e.g., "projects inherit from workspace")
- Implicit ordering or numbering schemes (e.g., "numerical prefix for build order")
- Per-entity completion flows (e.g., "per-task evaluation on completion")
- Auto-triggered state transitions (e.g., "auto-advance when all milestones done")
- Scope enforcement rules (e.g., "read-only outside write scope")
- IDE integration points (e.g., "Open in VS Code" on multiple surfaces)

## 4. FR Correctness

- [ ] Each FR accurately represents the source doc — no misstatements
- [ ] Lifecycle states match source docs exactly (no dropped/renamed/reordered states)
- [ ] Entity fields/attributes match source doc definitions
- [ ] Scoping rules match source docs (what's workspace-level vs project-level vs task-level)
- [ ] No FR contradicts another FR in the same document
- [ ] No FR contradicts a statement in the source docs

## 5. Terminology Consistency

- [ ] Same concept uses the same term throughout (not "task group" in one place and "work group" in another)
- [ ] Entity names match between definitions, FRs, data model, and milestones
- [ ] Status/state names are consistent (e.g., "Completing" vs "Complete" vs "Completed")
- [ ] Feature numbering (F1, F2...) is consistent between summary and detailed sections
- [ ] FR ID format is consistent (FR-N.M throughout)

## 6. Stimulus/Response Coverage

- [ ] Each feature section has a stimulus/response table
- [ ] Key user actions from the UI design doc appear as triggers
- [ ] System behaviors accurately describe what happens
- [ ] Edge cases are covered (what happens on failure, empty state, invalid input)
- [ ] Automated triggers are included (e.g., "all milestones complete" triggers status change)

## 7. NFR Completeness

- [ ] Performance requirements have measurable targets (latency, throughput)
- [ ] Security requirements cover all trust boundaries
- [ ] Reliability requirements address crash recovery and data durability
- [ ] Scalability requirements set upper bounds for key dimensions
- [ ] Usability requirements capture key UX principles from source docs
- [ ] Maintainability requirements specify quality gates and test coverage
- [ ] Responsive/mobile requirements included if applicable

## 8. Data Model Alignment

- [ ] Every entity in the data model has corresponding FRs that operate on it
- [ ] Entity attributes match what FRs require (no missing/extra fields)
- [ ] Relationships between entities match the hierarchy described in FRs
- [ ] Storage split (database vs filesystem) matches source doc architecture
- [ ] Search/index layer (if any) is accurately described

## 9. Milestone Traceability

- [ ] Every FR is mapped to at least one milestone
- [ ] FR ranges in the milestone table are correct (match actual FR IDs in section 4)
- [ ] Exit criteria for each milestone align with the FRs it includes
- [ ] Milestone dependencies are accurate and complete
- [ ] Dependency diagram matches the dependency table
- [ ] Deferred items are listed with correct target milestone
- [ ] No FR is claimed by multiple milestones without justification

## 10. Internal Consistency

- [ ] Section cross-references are valid (no broken "see Section N" links)
- [ ] Feature numbering (F1-FN) in the summary matches section 4 subsections
- [ ] All documents listed in References actually exist at the stated paths
- [ ] Open questions reference valid concepts and have owner/status
- [ ] Key decisions align with constraints and assumptions sections
- [ ] Out-of-scope items match the "will not" list in scope and the constraints section

## 11. Scope Alignment

- [ ] Scope "will not" list matches out-of-scope table
- [ ] Constraints section is consistent with operating environment
- [ ] Assumptions are reasonable and not contradicted by FRs
- [ ] No FRs describe features listed as out-of-scope
- [ ] Phasing/deferral table aligns with milestone boundaries
- [ ] External dependencies in assumptions match what milestones require
