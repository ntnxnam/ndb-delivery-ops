# Sync Hub — Requirements (removed)

**Route**: `/sync-hub` (redirects to `/project-status`)  
**Component**: removed  
**Audience**: `tpm`

---

## Purpose

The Sync Hub page was removed. Pages fetch live JIRA on load, scoped to the selected team's `baseFilter`. There is no cache-control UI and no page waits on a dataset sync.

Bookmarks to `/sync-hub` redirect to Project Status.

## Audiences

N/A — page is not in the product.

## User Stories

None. Former SH-* stories no longer apply.

## UI Behaviour

- Sync Hub is not in the sidebar.
- Sync Hub is not in `routeConfig` as a page.
- No Dataset freshness chip driven by Sync Hub.

## Permissions

The old `/sync-hub` permission mapping is gone.

## Edge Cases

| Case | Behaviour |
|------|-----------|
| User opens `/sync-hub` | Redirect to `/project-status` |

## Acceptance Criteria

- [ ] Sidebar has no Sync Hub item
- [ ] `/sync-hub` does not render a sync grid
- [ ] Project Status, Release Brief, SoS, Sprint Report, Component Report, Retrospective work without opening Sync Hub
