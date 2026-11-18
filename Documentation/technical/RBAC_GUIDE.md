# RBAC Guide: Roles and Permissions

## Role hierarchy

The app uses a simple role model: **Super Admin**, **Admin**, and **User**. Roles are defined in config so teams can change who has each role without code changes.

| Role           | Config key          | Permissions |
|----------------|---------------------|-------------|
| **Super Admin** | `superAdminUsers`   | Full access: release versions, sprint report, KPI view/edit, email history, **generic emailer**, **release setup**, KPI admin per team, and any future super-admin-only actions. |
| **Admin**       | `adminUsers`        | Same as above except **not** generic emailer and **not** release setup. Can send release emails, edit KPIs, access email history, sprint report, etc. |
| **User**        | (any authenticated) | View-only: reports, KPI view, release versions view (when env allows). |

Only **generic emailer** and **release setup** are restricted to Super Admin. All other admin-level actions are available to both Super Admin and Admin.

## Config-driven lists

Roles are configured in `server/config/allowedUsers.json`:

- **`superAdminUsers`**: list of usernames (e.g. `["namratha.singh"]`). Super Admin only.
- **`adminUsers`**: list of usernames (e.g. `["sneha.kulkarni"]`). Admin tier (does not include Super Admins; Super Admins automatically have admin permissions).

To change who is Super Admin or Admin as the team evolves, edit these arrays in `allowedUsers.json` and restart the server (or rely on config cache bust if applicable). No code change is required.

## Example config

```json
{
  "superAdminUsers": ["namratha.singh"],
  "adminUsers": ["sneha.kulkarni"],
  "allowedUsers": [ ... ],
  ...
}
```

## API exposure

The permissions endpoint (e.g. `/api/config/allowed-users`) can return `isSuperAdmin` and `isAdmin` for the current user so the client can show or hide UI (e.g. show "Release setup" only for Super Admin). The raw `superAdminUsers` / `adminUsers` lists are not exposed to the client.

## Legacy behavior

If `superAdminUsers` and `adminUsers` are missing or empty, the server falls back to the previous behavior using legacy keys (e.g. `genericEmailerAllowedUsers`, `releaseSetupAllowedUsers`) so existing deployments keep working.
