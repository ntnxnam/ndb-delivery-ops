# API: Team Overall Report

## Endpoint
`GET /api/reports/team-overall`

## Authentication
Bearer token (JIRA PAT) in `Authorization` header. `X-Username` header required.

## Query Parameters
See `Documentation/pages/TeamOverallReportPage-data-layer.md` for full parameter list.

## Response
See `Documentation/pages/TeamOverallReportPage-data-layer.md` for full DTO shape.

## Cache Invalidation
`POST /api/reports/team-overall/invalidate`
- Body: `{ "cacheKey": "..." }` (optional; clears all if omitted)
- Response: `{ "success": true, "message": "..." }`