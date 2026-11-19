# TPM Reports API — Preview & Send

Stage-aware TPM report for a release on a given `today` date. Preview is read-only (cited JQL + counts), Send is mass email via `emailConnector` with D26 role gate.

## POST /api/tpm/reports/preview
Auth: `Authorization: Bearer <JIRA PAT>` + `X-User-Email` optional. Middleware `validateJiraTokenMiddleware` (D40).

Body: `{ teamId: string, releaseVersion: string, today?: "YYYY-MM-DD" }` — `today` defaults to `new Date().toISOString().slice(0,10)` server-side.

Returns 200:
```json
{
  "teamId": "ndb",
  "releaseVersion": "NDB-2.12",
  "today": "2026-06-15",
  "stage": "execution|release|postRelease|overall",
  "reason": "today 2026-06-15 < codeComplete 2026-06-30",
  "nextGate": { "key": "ccm1Gate", "date": "2026-06-30", "label": "CCM1" } | null,
  "gateDates": { "...releaseGateDates[releaseVersion]" },
  "thresholds": { "code": "2026-06-30", "promotion": "2026-09-29", "ga": "2026-11-10" },
  "kpiBreakdown": [{ "id": "kpi_...", "name": "Product Blockers", "lifecyclePhase": "execution", "jql": "filter=NDB-2.12-All AND (project=ERA and priority = \"Blocker - P0\" and issuetype=Bug) AND status != Closed", "count": 76, "error": null, "citedAt": "2026-11-19T18:10:02.000Z" }],
  "total": 426,
  "fetchedAt": "2026-11-19T18:10:02.000Z",
  "recipients": { "to": ["a@nut..."], "cc": [] }
}
```
Counts via `jira.searchCount(jql)` per KPI, JQL normalized `type`→`issuetype` and `status != Closed` added when not present (parity with `kpiService`). `recipients` resolved from `releaseGateDates[release].devDRIs/qaDRIs` → `team.notificationEmails`.

Errors: `400 releaseVersion required`, `401 No Authorization header`.

## POST /api/tpm/reports/send
Auth: same + `X-User-Email` required for test mode. D26: `checkKpiAdminAuthorization(username, teamId)` — `kpiAdminUsers[teamId]` must contain username; default for unknown teams → `authorized:false`.

Body: `{ teamId, releaseVersion, today?, testMode: boolean, subject?, html? }`

- `testMode:true` → `to: [requestorEmail]`, `cc:[]`, bypasses admin check, 400 if `X-User-Email` missing.
- `testMode:false` → `to/cc` from `resolveRecipients`, 403 if not admin, 400 if no recipients resolved.
- `html` not provided → server builds table with `kpiBreakdown` exact JQL links (JIRA_BASE_URL).

Returns 200: `{ success: true, to: ["..."], cc: [], messageId, accepted, testMode }`. Status 403/400/500 on error.

## Stage Table
`execution` when `today < codeComplete`; `release` when `codeComplete <= today < promotion` (or `code <= today < ga` when no promotion, or `>= code` when no later gates); `postRelease` when `today >= ga`; else `overall` (missing/invalid gates). Thresholds are earliest `code`/`promotion`/`ga` bucket per `classifyGate` (case-insensitive, `ecDate`/`preEc`/`conceptCommit*` excluded from nextGate).

cURL:
```bash
curl -X POST /api/tpm/reports/preview -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -d '{"teamId":"ndb","releaseVersion":"NDB-2.12","today":"2026-06-15"}'
curl -X POST /api/tpm/reports/send -H "Authorization: Bearer $PAT" -H "X-User-Email: you@nutanix.com" -H "Content-Type: application/json" -d '{"teamId":"ndb","releaseVersion":"NDB-2.12","testMode":true}'
```
