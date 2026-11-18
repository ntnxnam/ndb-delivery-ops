# Weekly Skim — Data Layer

**Route**: `/release/weekly-skim`  
**Hook**: `useWeeklySkim`  
**Service (client)**: `release/services/weeklySkimService.js`  
**Service (server)**: `server/services/weeklySkimService.js`  
**API**: `POST /api/ai/weekly-skim`

---

## API endpoints called

| Call | When | Purpose |
|------|------|---------|
| `POST /api/jira/release-versions` | Page load (via `SelectedReleaseContext`) | Unreleased version list for type filter |
| `POST /api/ai/weekly-skim` | Generate | Per-release outstanding tiles + serial NAI release summaries → skim payload |

---

## Server flow

```
POST /api/ai/weekly-skim { productId, releases[] }
  → for each release (serial):
      computeOutstandingCounts (shared outstandingService — existing JQL)
      buildReleaseIntelligence (releaseAiSummaryService)
      generateReleaseSummary (naiService) — one NAI call
  → assemble THIS WEEK prose + rows + chase (≤3)
  → JSON response
```

No new JQL strings. Outstanding Open tile JQL and P0 / must-fix queries are those already used by Release Brief / release-summary.

---

## Response shape (success)

```json
{
  "generatedAt": "ISO",
  "thisWeek": "1–2 sentence story",
  "chase": [{ "text": "...", "release": "NDB-2.11" }],
  "rows": [
    {
      "release": "NDB-2.11",
      "ga": "2026-03-26",
      "rag": "YELLOW",
      "open": { "count": 142, "jql": "..." },
      "p0": { "count": 2, "jql": "..." },
      "mustFix": { "count": 5, "jql": "..." },
      "pulse": "Merge queue blocking CG",
      "summary": "full NAI markdown (for expand / Brief parity)",
      "error": null
    }
  ]
}
```

---

## Caching

None — on-demand. Latency ≈ (outstanding ~2s + NAI 15–30s) × N releases.

---

## Error handling

| Failure | Client |
|---------|--------|
| 400 missing releases / AI key | Inline error |
| 502 / 504 mid-run | Show partial rows if returned; else retry |
| Per-release error | `row.error` set; other rows OK |

---

## Client export

- HTML: `buildWeeklySkimHtml` → Blob download / clipboard
- PDF: `downloadPDF(previewRef, 'Weekly-Skim')` from existing `downloadUtils.js`
