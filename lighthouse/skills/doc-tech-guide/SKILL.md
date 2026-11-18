---
name: doc-tech-guide
description: Maintain the technical guide — HLD, LLDs, TECH_DESIGN, ARCHITECTURE, DECISIONS. Use when architecture, data model, or system design changes or user asks "update tech guide".
audience: architect, team_mgr, portfolio_mgr
---

## When to Use This Skill
- HLD / TECH_DESIGN / LLD-* / ARCHITECTURE.md / DECISIONS.md change
- New service, connector, or data pipeline ships
- User asks "update tech guide" / "document architecture for X"
- Pipeline stage 8.5 when diff touches `server/services/`, `shared/`, `server/config/`

## Quick Start
```
Input: { techArea, releaseName }
Output: lighthouse/docs/technical/<doc>.md
```

Procedure:
1. Inventory tech delta from diff (services, connectors, data flows, ADRs)
2. For each: purpose, diagram, contracts, invariants, rollback
3. Sections per `documentation-consistency.mdc`
4. Cite source file + line for every claim

## Delegation
Owner: `doc-specialist`. Triggered by `ops-assistant` or pipeline stage 8.5.
