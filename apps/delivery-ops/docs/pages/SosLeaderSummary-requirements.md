# SoS by Leader — Requirements

**Route**: `/sos-leader-summary`  
**Component**: `SosLeaderSummaryPage`  
**Permission**: `release_versions_view` (view); `email_send_generic` (send)  
**Audience**: `tpm`, `rm`; weekly digest for eng leadership

---

## Purpose

Feature/Initiative SoS payload regrouped as **Leader → Release → Features / Initiatives**, with per-leader KPIs, date/risk history, task breakdowns, NAI coaching Asks (release + sprint), and readiness-gated email to `sosEmailConfig` recipients.

---

## Audiences

| Audience | Use |
|----------|-----|
| Portfolio Manager / TPM | Leader sections, coaching Asks, drain Unmapped, email digest |
| RM | Confirm release breakdown under each leader matches SoS |

---

## User Stories

| ID | Story |
|----|-------|
| SLS-01 | As a TPM, I can open SoS by Leader and see four leader sections (Anil, Naveen, Jovan, Ashish) without selecting releases individually. |
| SLS-02 | As a TPM, under each leader I see the same release breakdown (gate strip + Features + Initiatives) as on SoS Summary for that leader's tickets. |
| SLS-03 | As a TPM, tickets are attributed by Assignee Manager rolling up through `ndbLeaderOrgConfig.json`. |
| SLS-04 | As a TPM, Unmapped tickets appear in a bottom section. |
| SLS-05 | As a TPM, I can Refresh All to pull live SoS data (same `/api/jira/sos-items` as SoS Summary). |
| SLS-06 | As a TPM, each leader section shows scoped KPI chips, struck date/risk history, and task breakdowns. |
| SLS-07 | As a TPM, Asks auto-generate after enrichment loads (and I can Regen / Generate All); Asks cite release + sprint signals. |
| SLS-08 | As a TPM, I can Email Leader SoS when enrichment is ready; recipients from `sosEmailConfig.json` + dialog. |

---

## UI Behaviour

```
Header + Generate All Asks + Refresh All + Email Leader SoS
├── Exec snapshot (data rollup: per-leader RAG / stale / outstanding / ask urgency)
├── Release timelines (once at page top)
├── Anil | Naveen | Jovan | Ashish (collapsible)
│   ├── Leadership Asks panel (auto after enrichment)
│   └── per release
│         ├── RAG chip + stale count + gate strip + KPI strip
│         ├── Inline RAG / gate chips (component donuts suppressed)
│         └── Features & Initiatives (history + breakdown)
└── Unmapped (if any)
```
(No per-release “Generate Exec Summary” / three-tier AI boxes — coaching Asks are the AI surface.
 Exec snapshot is deterministic counts from loaded SoS data, not NAI.)

---

## Permissions

- **View**: `release_versions_view`
- **Email**: `email_send_generic`

---

## Edge Cases

| Case | Expected |
|------|----------|
| Org config fails to load | Inline error; no leader sections |
| Assignee Manager empty / unknown | Item in Unmapped |
| Leader has zero items | Empty message under that leader |
| Nested managers (e.g. Balram under Akshay) | Roll up to Naveen |
| Email before enrichment | Button disabled |
| NAI unavailable | Rule-based Asks fallback |

---

## Acceptance Criteria

- [ ] Nav entry **SoS by Leader** visible to users with `release_versions_view`
- [ ] Page loads SoS items via existing `useSosItems` / `POST /api/jira/sos-items`
- [ ] Org map loaded from `GET /api/config/ndb-leader-org`
- [ ] Four leaders render with release subsections + KPIs + history + breakdowns
- [ ] Per-leader coaching via `POST /api/ai/sos-leader-coaching`
- [ ] Email Leader SoS uses Leader → Release HTML; recipients from config
- [ ] No hardcoded `localhost` in client/server paths
- [ ] Friday cron remains follow-on (not required for this phase)
