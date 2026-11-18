# Sync Hub — Data Layer (removed)

**Route**: `/sync-hub` redirects to `/project-status`. There is no page component.

Pages do **not** call `/api/release-dataset/sync-status`, `/sync`, `/sync/bucket`, or `/refresh-now`.

| Former consumer | Current data path |
|---|---|
| Project Status table | Live `POST /api/jira/release-items` with `teamId` + `baseFilter` |
| Version dropdown | Live `POST /api/jira/release-versions` → `listFixVersionsForTeam` |
| Release Brief / Retrospective | Live `GET /api/release-dataset/per-release/:release` |
| SoS | Live `POST /api/jira/sos-items` |
| Chat grounding | Live per-release fetch |

Server sync endpoints under `server/routes/releaseDataset.js` / `releaseSync.js` may still exist for internal/admin use. They are not part of the user-facing product.
