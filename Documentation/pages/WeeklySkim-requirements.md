# Weekly Skim — Requirements

**Route**: `/release/weekly-skim`  
**Component**: `WeeklySkimPage`  
**Permission**: `release_versions_view`  
**Audience**: `team-exec` / TPM — ADHD-friendly Monday email skim

---

## Purpose

One-screen multi-release health skim for email. Pick release **type by dots** (Major/Minor · Maintenance · Patch · Pre-release), select releases, generate a short THIS WEEK story + table + ≤3 chase items, then **Copy HTML / Download .html / Download .pdf**. Deep detail stays on **Release Brief** (sibling) — this page does not replace it.

---

## User Stories

| ID | Story |
|----|-------|
| WS-01 | As a TPM, I pick `•` / `••` / `•••` / EA and only see matching releases. |
| WS-02 | As a TPM, I multi-select releases and Generate to get outstanding counts + NAI pulse **one release at a time**. |
| WS-03 | As a leader, I skim THIS WEEK prose + a PDF-shaped table (Projects · Release Date · Key Content · Risks/Status with count pills) in under 10 seconds. |
| WS-04 | As a TPM, I download HTML or PDF (or copy HTML) to paste into Outlook. |
| WS-05 | As a TPM, I click a release name to open Release Brief for that version. |
| WS-06 | As a TPM, I click Open / P0 / Must-fix pills to open the exact JQL in JIRA (v1: count-as-link; dual-click panel when a drill exists later). |

---

## UI Behaviour

1. **Type chips** — Major/Minor (1 dot) · Maintenance (2) · Patch (3) · Pre-release (suffix). Default: Major/Minor.
2. **Release multi-select** — filtered list from team unreleased versions; pre-check active defaults when sensible.
3. **Generate** — show serial queue (`A → B → C`, ~15–30s each). Live per-release stream is Nice-to-have (v1 = queue label only).
4. **Preview** — visual RAG strip → THIS WEEK (1–2 sentences) → **PDF-shaped table** (Projects | Release Date | Key Content | Risks/Status with RAG + Open/P0/Must-fix pills) → CHASE (≤3).
5. **Export** — Copy HTML · Download HTML · Download PDF (preview ref) — same visual shape.
6. **Dual-click** — when a drill/sample exists: count → panel; Open in JIRA ↗ → exact JQL. When no in-app sample (v1 Open/P0/Must-fix pills): count may be the JIRA link alone (no redundant hint).
7. **Headline tone** — only RED uses “air cover”; YELLOW is “on watch”.

---

## Permissions

- Same as Release Brief: `release_versions_view`.

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| No releases in type | Empty list; Generate disabled |
| NAI key missing | Clear error; counts still attempted if possible |
| One release fails mid-loop | Row shows error; other releases keep results |
| Long run (many releases) | Progress text; client timeout ≥ 10 min |

---

## Acceptance Criteria

- [ ] Sibling of Release Brief — Brief unchanged
- [ ] Dot-type filter correct per release-types rules
- [ ] NAI called **serially** (one release at a time)
- [ ] Open / P0 / Must-fix use existing outstanding + release-summary intelligence (no new JQL without approval)
- [ ] HTML/PDF export usable in Outlook
- [ ] Fits 1280px without horizontal scroll
- [ ] Page docs present (`WeeklySkim-requirements.md`, `WeeklySkim-data-layer.md`)
