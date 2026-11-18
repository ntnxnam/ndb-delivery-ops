# Oncalls — Requirements

**Route**: `/oncalls`  
**Component**: `OncallsPage`  
**Permission**: `kpi_view`  
**Audience**: `tpm`, `team`, `rm`, `team-exec`

---

## Purpose

Ops info page for the OnCalls KPI: shared KPI Pulse (last 2 Nutanix Qs + weekly graph) plus chase outcomes for the OnCall → TechHelp → eng/docs stack (path coverage, portfolio gaps, CFD/CFI escalation).

Domain model (canonical taxonomy: `agent-pack/context/domain/oncall-outcome-taxonomy.md`):

```
OnCall     — customer hit an issue (seed)
├── TechHelp — workaround / guidance
├── SR       — knowledge byte / self-help
├── TECHPUBS — documentation outcome
└── Eng fix  — genuine engineering miss (linked non-OnCall/non-TH work)
```

---

## Audiences

| Audience | Use |
|----------|-----|
| TPM / Portfolio Manager | Weekly OnCall pulse + graph, missing remediation paths, chase list |
| EM / team | Who is getting hit, stuck dwell, eng ownership |
| RM | Interrupt load vs release work |
| Team Executive | Story caption + RAG-friendly pulse (no JQL in narrative) |

---

## User Stories

| ID | Story |
|----|-------|
| OC-01 | As a TPM, I open `/oncalls` and see KPI Pulse for the last 2 Nutanix Qs: open / aged / P0-P1 / created / resolved / net / MTTR / status dwell + weekly Created→Resolved→Closed chart. |
| OC-02 | As a TPM, I see path coverage (TechHelp / eng / docs linked) and portfolio outcomes that put chase gaps first (no path → need eng → need TechHelp → in flight). |
| OC-02b | As a TPM, the linked-downstream universe count is proof-only (footprint), not the primary chase signal. |
| OC-03 | As an EM, I see assignee and priority mix for open OnCalls. |
| OC-04 | As a TPM, after metrics load I get an AI portfolio narrative grounded in stack packets (OnCall + TechHelp + eng); I can regenerate. |
| OC-05 | As a TPM, each briefing cites only real ticket keys from the packet. |
| OC-06 | As a TPM, the OnCalls KPI chip on `/kpis` deep-links to `/oncalls`. |
| OC-07 | As a TPM, changing team reloads metrics for that team's OnCall config. |
| OC-08 | As a TPM, I see OnCalls that linked into CFD/CFI (or other configured) KPIs, with days from OnCall created to linked ticket cleared (median / p90). |
| OC-09 | As a TPM, field-ticket status in escalation drill is the real JIRA workflow status (Closed stays Closed — never labeled Resolved unless that is the status). |
| OC-10 | As a TPM, when About inference is unavailable I see one drawer note — not “NAI limited” on every row. |

---

## UI Behaviour

- Sections: **Pulse** (`KpiPulseBand`) · **Current** (path coverage + who is hit) · **Portfolio** (chase gaps + linked footprint proof) · **Past** · **Escalation**
- Header: title, team (from TeamContext), Pull from JIRA, as-of stamp, Generate AI Briefing
- Pulse mounted via shared kit only — no forked created/resolved chart; chart height ≤ 280px; toggles Line|Bars and Point-in-time|Cumulative
- Open-family pulse heroes (**Open now**, **Aged**, **P0**, **P1**): count → in-app PathDrill; **Open in JIRA ↗** → exact JQL. Created / Resolved / MTTR → JIRA only
- Path / portfolio / escalation heroes: count → drill; separate Open in JIRA ↗
- Escalation field tickets: **one** status chip = real `status` from JIRA; hero label **KPI cleared** (not “KPI resolved”)
- Escalation **Open in JIRA**: filter-style proof — OnCall window ∩ `linkedIssuesOf(CFD|CFI KPI union)` (not a frozen `key in (...)` list); tile count = that JQL’s `searchCount`
- About: inferred sentence when present; else muted path/status line; **one** drawer banner if About missing for the whole set
- Qualitative band: portfolio markdown + expandable per-OnCall stack cards
- AI briefing auto-runs after metrics load (suppressed for exec audience dual-auto); Regenerate reuses snapshot

---

## Permissions

- **View / refresh / AI**: `kpi_view`

---

## Edge Cases

- No open OnCalls → empty pulse heroes + empty briefing message
- `buildPulse` failure → pulse error on band; path/escalation still load
- TechHelp project missing / unlinkable → “without TechHelp” chips still work
- Eng project is not a fixed list — any linked non-OnCall/non-TechHelp ticket counts as eng_fix (SR/TECHPUBS classified separately in stacks)
- NAI unavailable → quantitative page works; About banner once per drawer; AI panel shows error

---

## Acceptance Criteria

- [x] Route `/oncalls` in sidebar for `kpi_view`
- [x] Pulse mounted via `buildPulse` + `KpiPulseBand` (no one-off 7d created/closed strip as primary)
- [x] Open-family pulse counts open PathDrill; Created/Resolved/MTTR are count → JIRA only
- [x] Path + escalation + open-family dual-click: never both external
- [x] Escalation Closed tickets never show a fake “Resolved” badge
- [x] About inference miss → ≤1 drawer banner; no per-row NAI-limited chrome
- [x] Stack classification: OnCall seed → TechHelp vs eng_fix / techpubs / knowledge via config
- [x] RAG is deterministic server-side; LLM copies it
- [x] KPI OnCalls widget deep-links to `/oncalls`
- [x] Page docs + API docs present
