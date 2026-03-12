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

### 1.3 References
Links to related docs, designs, APIs, prior art, or existing code.

---

## 2. Overall Description

### 2.1 Product Perspective
Is this new, a replacement, or part of something larger? Where does it sit in the system? Include a simple diagram if helpful.

### 2.2 Product Features (Summary)
Bullet list of major features. Details go in milestone sections (Section 6).

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

## 4. Non-Functional Requirements

Include only what's relevant. Delete unused sections.

### 4.1 Performance
| ID | Requirement |
|----|-------------|
| NF-1 | Page load shall complete within Xms under Y concurrent users. |

### 4.2 Security
| ID | Requirement |
|----|-------------|
| NF-2 | All API endpoints shall require authentication via [method]. |

### 4.3 Reliability / Availability
| ID | Requirement |
|----|-------------|
| NF-3 | System shall maintain X% uptime. |

### 4.4 Scalability
| ID | Requirement |
|----|-------------|
| NF-4 | System shall support up to X concurrent users. |

### 4.5 Usability
| ID | Requirement |
|----|-------------|
| NF-5 | Core workflows shall be completable within X clicks/steps. |

### 4.6 Maintainability
| ID | Requirement |
|----|-------------|
| NF-6 | Code shall follow [standard/pattern]. Test coverage shall exceed X%. |

---

## 5. Data Requirements

### 5.1 Data Model
Key entities and their relationships. ERD or simple table:

| Entity | Key Attributes | Relationships |
|--------|---------------|---------------|
| | | |

### 5.2 Data Retention & Migration
How long is data kept? Any migration from existing systems?

---

## 6. Milestones & Implementation Plan

### 6.1 Summary

| # | Milestone | Exit Criteria |
|---|-----------|---------------|
| M1 | | What must be true to call this done |
| M2 | | |

### 6.2 Dependencies

| Milestone | Blocked By | Notes |
|-----------|------------|-------|
| M2 | M1 | e.g. Needs data layer from M1 |

### 6.3 M1: [Milestone Name]

**Description:** What this milestone delivers, one paragraph.\
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

**Exit Criteria:** What must be true to call this milestone done.

### 6.N M[N]: [Next Milestone]
_(Repeat the block above)_

### 6.X Phasing / Deferral

Features or requirements explicitly deferred to future milestones:

| ID | Requirement | Deferred To | Reason |
|----|-------------|-------------|--------|
| | | | |

---

## 7. File Map & Implementation Sequence

```
path/to/
├── file.ts           # NEW or MODIFY: brief description
└── file.test.ts      # NEW
```

---

## 8. Key Decisions

1. **[Decision]**: Rationale and tradeoffs.

---

## 9. Out of Scope

| Feature | Deferred To | Reason |
|---------|-------------|--------|
| | | |

---

## 10. Dependencies

| Package | Target | Purpose |
|---------|--------|---------|
| | | |

---

## 11. Verification

Acceptance checklist — what must be manually or automatically verified before this is considered done.

1. `pnpm blt` passes
2. [Acceptance scenario]
3. [Acceptance scenario]

---

## 12. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | | | Open |

---

## 13. Revision History

| Date | Author | Changes | Version |
|------|--------|---------|---------|
| | | Initial draft | 0.1 |
