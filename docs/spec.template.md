# Software Requirements Specification
## [Project Name] — v[#]

**Prepared by:** [author]
**Date:** [date]
**Status:** Draft | In Review | Approved

---

## 1. Introduction

### 1.1 Purpose
What is this document specifying? What product/feature, what version or release?

### 1.2 Scope
What the system **will** and **will not** do. One paragraph. Name the software, state its purpose, and list high-level benefits. Call out anything explicitly excluded.

### 1.3 Definitions
| Term | Definition |
|------|------------|
| | |

### 1.4 References
Links to related docs, designs, APIs, prior art, or existing code.

---

## 2. Overall Description

### 2.1 Product Perspective
Is this new, a replacement, or part of something larger? Where does it sit in the system? Include a simple diagram if helpful.

### 2.2 Product Features (Summary)
Bullet list of major features. Details go in Section 5.

- Feature A
- Feature B

### 2.3 User Classes
| User Class | Description | Priority |
|------------|-------------|----------|
| e.g. Admin | Full access, manages settings | Primary |
| e.g. End User | Consumes content, limited permissions | Primary |

### 2.4 Operating Environment
Platform, OS, browser, runtime, infrastructure. What does this run on?

### 2.5 Constraints
Anything that limits implementation choices: tech stack mandates, regulatory requirements, performance budgets, third-party API limits, existing architecture decisions.

### 2.6 Assumptions & Dependencies
What are we assuming to be true? What external systems, services, or deliverables does this depend on?

---

## 3. External Interface Requirements

### 3.1 User Interfaces
High-level description of the UI. Screen flow, key interactions, responsive behavior. Reference wireframes/mockups if they exist.

### 3.2 Software Interfaces
APIs, databases, third-party services, libraries. For each: name, version, what data flows in/out, protocol.

### 3.3 Hardware Interfaces
Only if applicable. Device APIs, sensors, peripherals.

---

## 4. System Features

Repeat this block for each feature. Number them to enable traceability.

### 4.1 [Feature Name]

**Description:** What it does, one paragraph.
**Priority:** High | Medium | Low
**Stimulus/Response:**

| Trigger | System Behavior |
|---------|----------------|
| User clicks X | System does Y |
| API receives Z | System responds with W |

**Functional Requirements:**

| ID | Requirement |
|----|-------------|
| FR-1.1 | The system shall [behavior] when [condition]. |
| FR-1.2 | The system shall [behavior] when [condition]. |

**Behavioral Requirements:**

Gherkin scenarios mapping to functional requirements. Each scenario becomes one or more test cases.

```gherkin
Feature: [Feature Name]
  [Brief feature description]

  Scenario: [Scenario name] (FR #N)
    Given [precondition]
    When [action]
    Then [expected result]
```

### 4.N [Next Feature]
_(Repeat the block above)_

---

## 5. Non-Functional Requirements

Include only what's relevant. Delete unused sections.

### 5.1 Performance
| ID | Requirement |
|----|-------------|
| NF-1 | Page load shall complete within Xms under Y concurrent users. |

### 5.2 Security
| ID | Requirement |
|----|-------------|
| NF-2 | All API endpoints shall require authentication via [method]. |

### 5.3 Reliability / Availability
| ID | Requirement |
|----|-------------|
| NF-3 | System shall maintain X% uptime. |

### 5.4 Scalability
| ID | Requirement |
|----|-------------|
| NF-4 | System shall support up to X concurrent users. |

### 5.5 Usability
| ID | Requirement |
|----|-------------|
| NF-5 | Core workflows shall be completable within X clicks/steps. |

### 5.6 Maintainability
| ID | Requirement |
|----|-------------|
| NF-6 | Code shall follow [standard/pattern]. Test coverage shall exceed X%. |

---

## 6. Data Requirements

### 6.1 Data Model
Key entities and their relationships. ERD or simple table:

| Entity | Key Attributes | Relationships |
|--------|---------------|---------------|
| | | |

### 6.2 Data Retention & Migration
How long is data kept? Any migration from existing systems?

---

## 7. Milestones & Implementation Plan

### 7.1 Milestones

| # | Milestone | Features Included | Target Date | Exit Criteria |
|---|-----------|-------------------|-------------|---------------|
| M1 | | FR-x.x, FR-y.y | | What must be true to call this done |
| M2 | | FR-z.z | | |

### 7.2 Dependencies

| Milestone | Blocked By | External Dependencies |
|-----------|------------|----------------------|
| M2 | M1 | e.g. API access from vendor |

### 7.3 Phasing / Deferral

Features or requirements explicitly deferred to future milestones:

| ID | Requirement | Deferred To | Reason |
|----|-------------|-------------|--------|
| | | | |

---

## 8. New/Modified File Map

```
path/to/
├── file.ts           # NEW or MODIFY: brief description
└── file.test.ts      # NEW
```

---

## 9. Implementation Sequence

> TDD throughout: write failing tests first, then implement.

### Phase 1: [Phase Name]

**Files**: `path/to/file.ts`, `path/to/file.test.ts`

1. Step description.
2. Step description.
3. Tests: what to test.

### Phase N: [Next Phase]
_(Repeat the block above)_

---

## 10. Key Decisions

1. **[Decision]**: Rationale and tradeoffs.

---

## 11. Out of Scope

| Feature | Deferred To | Reason |
|---------|-------------|--------|
| | | |

---

## 12. Dependencies to Add

| Package | Target | Purpose |
|---------|--------|---------|
| | | |

---

## 13. Verification

Acceptance checklist — what must be manually or automatically verified before this is considered done.

1. `pnpm blt` passes
2. [Acceptance scenario]
3. [Acceptance scenario]

---

## 14. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | | | Open |

---

## 15. Revision History

| Date | Author | Changes | Version |
|------|--------|---------|---------|
| | | Initial draft | 0.1 |