# JIRA — Sprint Performance API

Route file: `server/routes/jira/sprint-performance.js` (mounted at `/api/jira`).
Service: `server/services/sprintPerformanceReportService.js`.

Every endpoint uses the same auth: `releaseVersionsLimiter`, then `validateJiraTokenMiddleware`, then `requireAuth('sprintReport')`.
Required headers: `Authorization: Bearer <JIRA PAT>` and `X-Username`.

---

### GET /api/jira/sprint-performance/reports

**Purpose**: List the generated Sprint Performance reports for a team, newest first, plus the current generation job.

**Auth**: required (`sprintReport`)

**Request**
- Query: `teamId` (string, optional, default `ndb`). Team id from `teamBoardConfig.json`.

**Server flow**
Route → `listReports(teamId)` + `getJob(teamId)` → disk (`apps/delivery-ops/reports/`)

**Response shape**
```json
{ "success": true,
  "reports": [{ "file": "Sprint-NDB-S54-S59-2026-10-07.html", "window": "S54–S59", "date": "2026-10-07", "modifiedAt": "2026-10-07T11:57:31.000Z", "bytes": 589539 }],
  "job": { "state": "idle" } }
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | Unknown `teamId` | Pick a valid team |
| 401 | Missing or invalid JIRA token | Re-login |
| 403 | User lacks `sprintReport` access | Request access |

**Caching**
No caching. Reads the directory on every call.

---

### GET /api/jira/sprint-performance/report

**Purpose**: Return one report's self-contained HTML, either for embedding or for download.

**Auth**: required (`sprintReport`)

**Request**
- Query: `teamId` (string, optional, default `ndb`).
- Query: `file` (string, optional). Must be a file returned by `/reports`; defaults to the newest.
- Query: `download` (`1`, optional). Adds `Content-Disposition: attachment`.

**Server flow**
Route → `readReport(teamId, file)` → disk. The file name is matched against the listing, so arbitrary paths cannot be read.

**Response shape**
`200 text/html` — the full report document.

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | Unknown `teamId` | Pick a valid team |
| 401 / 403 | Auth failure | Re-login / request access |
| 404 | No report generated yet (or `file` not found) | Show empty state; offer Generate |

**Caching**
No caching. The file on disk is the artifact.

---

### POST /api/jira/sprint-performance/generate

**Purpose**: Start a background job that fetches the last N cadence sprints from live JIRA and writes a new report.

**Auth**: required (`sprintReport`). JIRA calls use the caller's token.

**Request**
- Body: `teamId` (string, optional, default `ndb`).

**Server flow**
1. Route → `startGeneration`.
2. `collectSprintPerformance` makes the JIRA calls (board sprints → per-sprint JIRA Sprint Report `greenhopper/1.0/rapid/charts/sprintreport` → user groups).
3. `computeFromRaw` → `writeReport` → disk.

**Response shape**
`202`
```json
{ "success": true, "job": { "state": "running", "teamId": "ndb", "startedAt": "…", "progress": "94 sprints in window (slots 54–59)" } }
```
If a job is already running for the team, that job is returned and no new job starts.

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | Unknown `teamId` | Pick a valid team |
| 401 / 403 | Auth failure | Re-login / request access |
| 429 | Rate limiter tripped | Wait and retry |

**Caching**
Not applicable. A run takes about 3–4 minutes for the 2-year window (~500 sprints).

---

### GET /api/jira/sprint-performance/status

**Purpose**: Poll the current generation job for a team.

**Auth**: required (`sprintReport`)

**Request**
- Query: `teamId` (string, optional, default `ndb`).

**Server flow**
Route → `getJob(teamId)` → in-memory job map (the token is never returned).

**Response shape**
```json
{ "success": true, "job": { "state": "done", "teamId": "ndb", "startedAt": "…", "finishedAt": "…", "progress": "…", "file": "Sprint-NDB-S54-S59-2026-10-07.html" } }
```
`state` is one of `idle`, `running`, `done` or `error` (with `error`).

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | Unknown `teamId` | Pick a valid team |
| 401 / 403 | Auth failure | Stop polling; re-login |

**Caching**
In memory only; resets when the server restarts. Poll only while `state === 'running'`.
