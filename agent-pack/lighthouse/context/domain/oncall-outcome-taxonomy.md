# OnCall outcome taxonomy (Ops learning)

**Audience**: agents working `/oncalls`, KPI OnCalls, AI briefing  
**Source**: Portfolio Manager Ops guidance (2026-10-16)  
**Status**: canonical — prefer this over inventing new categories

When an OnCall (customer hit) is filed and linked into TechHelp / downstream tickets,
classify the *outcome nature* into one of these buckets. Categories help decide
chase asks and whether engineering quality / tests are in question.

## Categories

| Category | Meaning | Typical signal | Downstream | Ask when reviewing |
|---|---|---|---|---|
| **Customer environment** | Issue is on the customer’s setup / ops / config — not an NDB product defect | TH stuck on customer data, env specifics, “works in lab” | Often TH-only; may close without eng | Help customer / document runbook; do **not** treat as eng miss |
| **Documentation miss** | Product behaviour correct but docs / ports / procedures were wrong or missing | Linked **TECHPUBS** | TechPubs ticket | Fix docs; track docs debt; not a code-quality failure |
| **Known issue → knowledge byte** | Already understood; captured for self-help / KB | Linked **SR** (knowledge / self-help) | SR | Do **not** count as eng remediation; measure as self-help coverage |
| **Genuine engineering miss** | Real product / code defect we should have caught | Linked eng project bug/task (ERA, ENG, …) — not TH/OnCall/SR | Eng fix ticket | **Why didn’t internal tests / smokes / system test catch this?** Owner + gap (coverage, env, signal) |

## Stack model (unchanged)

```
OnCall     — customer hit an issue (seed)
├── TechHelp (TH) — workaround / guidance
├── SR            — knowledge byte / self-help (known issue)
├── TECHPUBS      — documentation outcome (docs miss)
└── Eng project   — genuine engineering miss (code change)
```

## Scope JQL (approved)

- **KPI / heroes**: team OnCalls KPI `baseQuery` from `kpiConfig.json` (not hard-coded in services)
- **Linked downstream (all tickets)**:  
  `issueFunction in linkedIssuesOf("<OnCalls KPI baseQuery>")`  
  → OnCalls `baseQuery` comes only from kpiConfig (e.g. `filter=NDB-OnCalls`)

## Config map (`oncallConfig.json`)

| Config key | Projects / rule |
|---|---|
| `techHelpProjects` | `TH`, `TechHelp` |
| `knowledgeProjects` | `SR` |
| `techPubsProjects` | `TECHPUBS` |
| *(linkedOut)* | Full `linkedIssuesOf(OnCalls KPI baseQuery)` — no project exclude |

## AI briefing obligations

When generating OnCall qualitative analysis:

1. Prefer classifying open stacks into the four categories above (best-effort from links + comments).
2. For **engineering miss**, always surface a test-gap question (smokes / system test / precommit / missing scenario).
3. Never call SR “eng fix”; never treat TechPubs as a code defect unless comments prove otherwise.
4. TechHelp Nature section: themes across TH (provisioning, patch, TM, networking, waiting-on-eng, etc.).

## Never do

- Collapse all non-OnCall links into “eng”
- Blame engineering for customer-env or docs-only outcomes
- Drop TechPubs from insight (docs debt is a real signal)
- Invent a fifth category without updating this file
