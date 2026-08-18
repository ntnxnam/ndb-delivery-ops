---
report_type: LLD
module: Authentication & RBAC
version: "2.0"
generated: 2026-08-04
status: current
---

# Low-Level Design: Authentication & RBAC

---

## 1. Overview

Authentication is JIRA PAT-based. There is no internal user database: identity is validated live against JIRA's `/rest/api/2/myself` API. Authorization is config-driven: `server/config/allowedUsers.json` maps users to legacy role buckets; `LEGACY_PERMISSION_MAPPING` expands those to fine-grained permissions.

---

## 2. Files

| File | Purpose |
|---|---|
| `server/routes/auth.js` | `/api/auth/login`, `/api/auth/logout`, `/api/auth/status` |
| `server/config/allowedUsers.json` | Role bucket lists (superAdminUsers, adminUsers, etc.) |
| `client/src/auth/index.js` | Exports: `AuthContext`, `AuthProvider`, `ProtectedRoute`, `LoginForm` |
| `client/src/auth/constants/permissions.js` | `PERMISSIONS` enum + `LEGACY_PERMISSION_MAPPING` (mirrors server) |

---

## 3. Login Flow

```
POST /api/auth/login { email, jiraToken }

1. Server validates token:
   GET {JIRA_URL}/rest/api/2/myself
   Authorization: Bearer {jiraToken}

2. If 401 → return 401 { success: false, error: "Invalid token" }

3. Normalize username:
   - strip @nutanix.com suffix if present
   - lowercase

4. Load allowedUsers.json; compute permissions:
   for each bucket in LEGACY_PERMISSION_MAPPING:
     if username in allowedUsers[bucket]:
       push all permissions in LEGACY_PERMISSION_MAPPING[bucket]
   deduplicate

5. Return 200 {
     success: true,
     username,
     email,
     permissions: string[]    // e.g. ["release_versions_view", "kpi_view", ...]
   }
```

### 3.1 allowedUsers.json Structure

```json
{
  "superAdminUsers": ["namratha.singh"],
  "adminUsers": [],
  "kpiTabAllowedUsers": ["namratha.singh", "some.tpm"],
  "releaseConfigAllowedUsers": ["namratha.singh"],
  "genericEmailerAllowedUsers": ["namratha.singh"],
  "releaseSetupAllowedUsers": ["namratha.singh"],
  "aiInsightsAllowedUsers": ["namratha.singh"]
}
```

### 3.2 LEGACY_PERMISSION_MAPPING

```javascript
const LEGACY_PERMISSION_MAPPING = {
  superAdminUsers: [
    'release_versions_view', 'email_history_view', 'sprint_reports_view',
    'kpi_view', 'kpi_manage', 'release_config_manage', 'release_setup_manage',
    'email_send_generic', 'admin_panel_access', 'ai_insights_view',
  ],
  adminUsers: [
    'release_versions_view', 'email_history_view', 'sprint_reports_view',
    'kpi_view', 'admin_panel_access',
  ],
  kpiTabAllowedUsers: ['kpi_view'],
  releaseConfigAllowedUsers: ['release_config_manage'],
  genericEmailerAllowedUsers: ['email_send_generic'],
  releaseSetupAllowedUsers: ['release_setup_manage'],
  aiInsightsAllowedUsers: ['ai_insights_view'],
};
```

All authenticated users (not in any bucket) get `['release_versions_view']` as the baseline.

**This mapping must be identical in `server/routes/auth.js` and `client/src/auth/constants/permissions.js`. If they diverge, sidebar items may show when the API rejects them (or vice versa).**

---

## 4. Client-Side Auth State

```javascript
// AuthContext holds:
{
  isAuthenticated: boolean,
  username: string,          // normalized
  jiraToken: string,         // stored in localStorage['jiraToken']
  permissions: string[],     // stored in localStorage['permissions']
  login(email, token) → Promise,
  logout() → void,
}
```

### 4.1 ProtectedRoute

```jsx
function ProtectedRoute({ requiredPermission, children }) {
  const { isAuthenticated, permissions } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (requiredPermission && !permissions.includes(requiredPermission))
    return <Navigate to="/" />;
  return children;
}
```

### 4.2 Sidebar Permission-Gating

```javascript
// routeConfig.js — each route entry:
{
  path: '/sprint-report',
  component: SprintReportPage,
  permission: 'sprint_reports_view',
  label: 'Sprint Report',
  icon: BarChartIcon,
}
// Sidebar filters: items where !permissions.includes(permission) are hidden
```

**Per D6:** Only the admin tab is a true security gate. All other tabs are visible to every authenticated user by default. The `permission` field in routeConfig controls sidebar visibility as a UX convenience, not as a security boundary; the API enforces independently.

---

## 5. Server-Side Middleware

```javascript
// Applied to all /api/jira/* and /api/ai/* routes
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  req.jiraToken = token;
  next();
}
```

The server does NOT maintain sessions. Each API call that touches JIRA carries the user's token in `Authorization` and uses it for the outbound JIRA call. This means the user's JIRA permissions control what data they can read, independent of the app's RBAC.

---

## 6. Rate Limiting

```javascript
// Auth endpoints: strict
rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts' })

// Email send
rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })

// Checkpoint history (expensive JIRA pagination)
rateLimit({ windowMs: 15 * 60 * 1000, max: 30 })

// General API
rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })
```

---

## 7. Security Notes

- JIRA token never logged (redacted in all log statements).
- `localStorage` cleared on logout (explicit) and on 401 response from server.
- CORS: `Access-Control-Allow-Origin` restricted to `ALLOWED_ORIGINS` env var (comma-separated). No wildcard.
- Helmet.js adds: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Content-Security-Policy`.

---

## 8. Edge Cases

| Scenario | Behavior |
|---|---|
| Token expires mid-session | Next API call returns 401; client clears localStorage and redirects to login |
| User removed from allowedUsers.json | Next login returns reduced permissions; session refreshable via "Test Connection" button |
| Duplicate user in multiple buckets | Permission union; no duplicates in final array |
| Username with domain suffix | Normalized: `namratha.singh@nutanix.com` → `namratha.singh` |
| Admin tab access for non-admin | `ProtectedRoute` redirects to `/`; API returns 403 independently |
| "Test Connection & Refresh Permissions" | Forces `POST /api/auth/login`; updates localStorage permissions in place |
