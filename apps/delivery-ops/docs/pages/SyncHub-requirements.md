# Sync Hub — Requirements

**Route**: `/sync-hub`  
**Component**: `SyncHubPage`  
**Permission**: `RELEASE_VERSIONS_VIEW`  
**Audience**: `tpm`, `rm` — cache control surface for the release dataset

---

## Purpose

Sync Hub is the control panel for the on-disk JIRA release dataset. TPMs and RMs inspect per-release × per-bucket freshness, re-fetch a single bucket (cell), a single current release (row), or all current and upcoming releases (**Sync current & upcoming**). Every other page reads from the resulting bundle — this page is the only place that should trigger JIRA payload fetches.

## Audiences

Primary: `tpm`, `rm`  
Secondary: `portfolio_mgr` (same controls; denser activity log is acceptable)

## User Stories

| ID | Story |
|----|-------|
| SH-01 | As a TPM, I can see last-sync age and ticket count for each Group-1 bucket of every current and past release. |
| SH-02 | As a TPM, I can refresh **one cell** (one bucket × one release) without changing sibling cells' timestamps or disabling other releases. |
| SH-03 | As an RM, I can sync all current and upcoming (non-past) releases and watch per-release progress without the whole table lighting up as queued. |
| SH-04 | As a TPM, I can cancel an in-flight cell sync from that cell's refresh button. |
| SH-05 | As a user, a timed-out bucket keeps its previous cached tickets instead of wiping to empty. |
| SH-06 | As a user, current & upcoming sync skips changelog by default so it finishes inside the proxy window; I can opt in to changelog when I need Closed Date / reopen counts. |
| SH-07 | As a TPM, I can see the last full-release sync date for current and upcoming releases as a group and on each row. |

## UI Behaviour

- Two tables: **Current & upcoming** (active + future) and **Past Releases**.
- Six bucket columns + a read-only **History** column (union count). History age is last *full-release* fetch, not last cell sync.
- Each current/upcoming row shows its last full-release sync date. The section header shows the most recent among those rows.
- Cell refresh: spinner only on the clicked cell; sibling cells on the same release disable (release lock); other releases stay clickable.
- Clicking the spinning cell button cancels the client request.
- Row refresh (current releases only): yellow highlight on that row only.
- Header: **Include changelog (slow)** checkbox (off by default), **Sync current & upcoming**, disk **Refresh**.
- No **Refresh Now** on this page — that path held HTTP for a full scheduler run with changelog and routinely hit nginx 300s.

## Permissions

- **View / sync**: `release_versions_view` (same as Project Status)

## Edge Cases

1. Empty bucket after a successful fetch shows `0`, not `—`.
2. Cell sync failure leaves the previous count/age and marks the cell failed (retry from the same button).
3. Past releases: cell sync only. Sync current & upcoming never force-refetches past releases.
4. Hung SSE: heartbeat comments keep nginx alive; client AbortController clears `activeCellSync`.

## Acceptance Criteria

- [ ] Clicking refresh on one cell does not stamp sibling cells to "just now"
- [ ] Only the clicked cell spins; other releases remain usable
- [ ] Full Sync / row sync does not paint unrelated rows as syncing
- [ ] Include changelog is off by default
- [ ] Refresh Now is not on this page
- [ ] Timed-out cell does not wipe that bucket's cached tickets
- [ ] Sync current & upcoming does not fetch past releases
- [ ] Current & upcoming section and each row show a last-sync date
