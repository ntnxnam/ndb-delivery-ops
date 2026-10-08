# System-Test Scale — Requirements

**Route**: `/system-test-scale`  
**Component**: `SystemTestScalePage`  
**Permission**: `kpi_view`  
**Audience**: `tpm`, `rm`, `qa_lead`

---

## Purpose

Exec-facing dashboard for System-Test bug scale and regression health, scoped by team KPI `filter={teamCode}-System-Test` (e.g. NDB → `filter=NDB-System-Test`) and typed by JIRA field `cf[13260]` (`Regression?`). Surfaces release-to-release trends, aging, carry-over, and component hotspots with click-through JIRA authenticity.

---

## Audiences

| Audience | Use |
|----------|-----|
| TPM / Portfolio Manager | Release health RAG, regression rate / escape rate, carry-over debt |
| RM | Gate-adjacent quality signal (open regs, aged open, TBV) |
| QA lead | B2B vs R2R mix, longevity, component hotspots |

---

## User Stories

| ID | Story |
|----|-------|
| STS-01 | As a TPM, I can open System-Test Scale and see current vs compare release hero metrics with JIRA links. |
| STS-02 | As a TPM, I see release-over-release trend charts for volume, typed regressions, rates, aging, and TBV. |
| STS-03 | As a QA lead, I can filter by team + current/compare releases and Pull from JIRA to refresh live counts. |
| STS-06 | As a TPM, changing Team rebuilds all JQL with `filter={teamCode}-System-Test`. |
| STS-04 | As a TPM, I can open any count in JIRA using the exact JQL that produced it. |
| STS-05 | As a QA lead, I see component tiles for open / Yes* / open R2R on configured releases. |

---

## UI Behaviour

Two visually distinct bands so filter scope is never ambiguous:

```
Header (title + Pull from JIRA + as-of stamp)

Filtered view  (teal band · badge "Uses filters")
  Controls (team · current · compare)
  RAG + hero metrics · delta table · carry-over · component map

All-release view  (slate band · badge "Ignores release filters")
  Regression heatmap (all configured releases for team; Current outlined)
  Trend charts (all releases for team; Current marked with reference line)
```

- Team picker (page + sidebar) sets `teamId` → server resolves `filter={teamCode}-System-Test`.
- **Current / Compare apply instantly client-side** from the loaded `byRelease` payload — no submit button, no JIRA re-pull.
- **Team change or Pull from JIRA** reloads live counts (~1–2 min).
- Widgets that change with Current / Compare live in the Filtered band.
- Heatmap and trends always show every configured release for the selected team; Current is orientation-only.
- Counts are hyperlinks to JIRA issue search.
- Rate % numbers open the numerator set (Yes* or R2R).
- Pull from JIRA re-counts live (~45–90s); page load does the same.

---

## Permissions

- **View / refresh**: `kpi_view`

---

## Edge Cases

- Missing `filter={rel}-All` → counts may be zero; surface empty states without crashing.
- `cf[13260]` EMPTY tracked as data-quality metric.
- Load and Pull both re-query JIRA (no cache).

---

## Acceptance Criteria

- [ ] Route `/system-test-scale` in sidebar for users with `kpi_view`.
- [ ] Live counts for configured releases with `cf[13260]` typing.
- [ ] At least one multi-release trend chart rendered.
- [ ] Every displayed count links to correct JQL.
- [ ] Pull from JIRA updates snapshot timestamp.
