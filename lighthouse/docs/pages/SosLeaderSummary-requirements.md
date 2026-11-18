# SoS by Leader (temp) — Requirements

**Route**: `/sos-leader-summary`  
**Component**: `SosLeaderSummaryPage`  
**Permission**: `release_versions_view`  
**Audience**: `tpm`, `rm` (layout review); eventual weekly digest for eng leadership

---

## Purpose

Temporary review surface that shows the SoS payload regrouped as **Overall → Leader → Release**. Used to validate the NDB eng-leader org map (Anil / Naveen / Jovan / Ashish) before wiring a Friday 09:30 IST email job.

---

## Audiences

| Audience | Use |
|----------|-----|
| Portfolio Manager / TPM | Review overall rollup and leader sections; drain Unmapped managers |
| RM | Confirm release breakdown under each leader matches SoS |

---

## User Stories

| ID | Story |
|----|-------|
| SLS-01 | As a TPM, I can open SoS by Leader and see four leader sections (Anil, Naveen, Jovan, Ashish) without selecting releases individually. |
| SLS-02 | As a TPM, under each leader I see release details (gate strip + Features + Initiatives) for that leader's tickets. |
| SLS-03 | As a TPM, tickets are attributed by Assignee Manager rolling up through `ndbLeaderOrgConfig.json`. |
| SLS-04 | As a TPM, Unmapped tickets appear in a bottom section with a list of Assignee Manager names to add to config. |
| SLS-05 | As a TPM, I can Refresh All to pull live SoS data (same `/api/jira/sos-items` as SoS Summary). |
| SLS-06 | As a TPM, I see an Overall section (RAG, KPI, overall GenAI summary, category counts, release Gantts) before leader buckets. |
| SLS-07 | As a TPM, under each Leader → Release I see one leader-context GenAI summary (not FEAT/Standalone/Direct tier boxes). |

---

## UI Behaviour

```
TEMP banner (layout review — no email)
Header + Refresh All
├── Overall
│     ├── RAG breakdown (cross-release heatmap)
│     ├── KPI (unscoped strips per active release)
│     ├── Overall GenAI summary (auto after JIRA ready)
│     ├── Category of work (FEAT / Standalone / Direct counts)
│     └── Release Gantts (timelineOnly per active release)
├── Anil | Naveen | Jovan | Ashish (collapsible)
│   └── per release
│         ├── Leader-context GenAI summary (one box)
│         └── Details (ReleaseSection with showTierSummary=false):
│               gate Gantt, KPI strip, SosReleaseCharts,
│               Features & Initiatives tables
└── Unmapped (if any) — same structure
```

- No FEAT / Standalone / Direct AI tier boxes under Leader (those remain on SoS Summary only).
- No Email SoS button in this phase.
- GenAI auto-loads after items + breakdowns + gates (+ project-status for overall); leader×release jobs queue one at a time.

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
| AI_API_KEY missing | Summary boxes show error + Retry |

---

## Acceptance Criteria

- [ ] Nav entry **SoS by Leader (temp)** visible to users with `release_versions_view`
- [ ] Page loads SoS items via existing `useSosItems` / `POST /api/jira/sos-items`
- [ ] Org map loaded from `GET /api/config/ndb-leader-org`
- [ ] Overall section renders RAG, KPI, overall summary, category chips, Gantts
- [ ] Four leaders render with release subsections; no tier boxes under Leader
- [ ] One leader-context summary per Leader × Release
- [ ] Unmapped section lists distinct Assignee Manager names
- [ ] No Friday cron or SMTP send in this phase
- [ ] No hardcoded `localhost` in client/server paths
