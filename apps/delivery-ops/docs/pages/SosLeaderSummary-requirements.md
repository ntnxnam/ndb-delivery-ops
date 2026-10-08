# SoS by Leader (temp) — Requirements

**Route**: `/sos-leader-summary`  
**Component**: `SosLeaderSummaryPage`  
**Permission**: `release_versions_view`  
**Audience**: `tpm`, `rm` (layout review); eventual weekly digest for eng leadership

---

## Purpose

Temporary review surface that shows the same Feature/Initiative SoS payload as SoS Summary, regrouped as **Leader → Release → Features / Initiatives**. Used to validate the NDB eng-leader org map (Anil / Naveen / Jovan / Ashish) before wiring a Friday 09:30 IST email job.

---

## Audiences

| Audience | Use |
|----------|-----|
| Portfolio Manager / TPM | Review leader sections and drain Unmapped managers |
| RM | Confirm release breakdown under each leader matches SoS |

---

## User Stories

| ID | Story |
|----|-------|
| SLS-01 | As a TPM, I can open SoS by Leader and see four leader sections (Anil, Naveen, Jovan, Ashish) without selecting releases individually. |
| SLS-02 | As a TPM, under each leader I see the same release breakdown (gate strip + Features + Initiatives) as on SoS Summary for that leader's tickets. |
| SLS-03 | As a TPM, tickets are attributed by Assignee Manager rolling up through `ndbLeaderOrgConfig.json`. |
| SLS-04 | As a TPM, Unmapped tickets appear in a bottom section with a list of Assignee Manager names to add to config. |
| SLS-05 | As a TPM, I can Refresh All to pull live SoS data (same `/api/jira/sos-items` as SoS Summary). |

---

## UI Behaviour

```
TEMP banner (layout review — no email)
Header + Refresh All
├── Anil | Naveen | Jovan | Ashish (collapsible)
│   └── per release
│         ├── RAG chip + gate strip
│         ├── Features table
│         └── Initiatives table
└── Unmapped (if any) — manager name list + same release tables
```

- No Email SoS button in this phase.
- Each release under a leader reuses SoS `ReleaseSection`: gate Gantt (struck superseded dates), KPI strip, AI tier boxes, SosReleaseCharts (RAG / outstanding / component), Features & Initiatives tables with date history + risk-indicator history + AI summary + task breakdown.

---

## Permissions

- **View**: `release_versions_view` (same as SoS Summary)

---

## Edge Cases

| Case | Expected |
|------|----------|
| Org config fails to load | Inline error; no leader sections |
| Assignee Manager empty / unknown | Item in Unmapped |
| Leader has zero items | Empty message under that leader |
| Nested managers (e.g. Balram under Akshay) | Roll up to Naveen |

---

## Acceptance Criteria

- [ ] Nav entry **SoS by Leader (temp)** visible to users with `release_versions_view`
- [ ] Page loads SoS items via existing `useSosItems` / `POST /api/jira/sos-items`
- [ ] Org map loaded from `GET /api/config/ndb-leader-org`
- [ ] Four leaders render with release subsections
- [ ] Unmapped section lists distinct Assignee Manager names
- [ ] No Friday cron or SMTP send in this phase
- [ ] No hardcoded `localhost` in client/server paths
