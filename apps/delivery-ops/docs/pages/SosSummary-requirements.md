# SoS Summary Page — Requirements

## Purpose

The SoS Summary page is the Scrum-of-Scrums control surface for engineering leadership. It collates all Feature and Initiative tickets across every active release, synthesises each ticket's status into an AI-generated executive summary, surfaces per-release KPI health, and lets the Portfolio Manager compose and send a structured SoS briefing email to VPs and directors.

The page loads from the on-disk release dataset so it stays usable when JIRA is rate-limited. Refresh All pulls live JIRA and falls back to cache if JIRA returns 429.

## Audiences

Primary: `vp`, `director`
Secondary: `tpm`, `rm` (compose and review flow)

## User Stories

1. As a Portfolio Manager, I can open the SoS page and see all active releases in one scrollable view without selecting them individually.
2. As a Portfolio Manager, I can see Features and Initiatives for each release with an AI-generated executive summary (RAG + prose) per ticket, so I do not have to read raw status update text.
3. As a Portfolio Manager, I can see task breakdown per Feature/Initiative (done vs remaining vs in-progress) to understand delivery progress at a glance.
4. As a Portfolio Manager, I can see configured KPI widgets per release (open P0s, must-fix tickets, etc.) so I have quantitative risk signals alongside qualitative status.
5. As a Portfolio Manager, I can click Email SoS and send an HTML snapshot of the already-loaded page (including CC/CG/PG date history) via SMTP to the status-sender recipient list, without refetching JIRA.
6. As a Portfolio Manager, I can refresh data per-release without reloading the entire page.

## UI Behaviour

### Page structure

The page uses the shared app `Layout` and left nav (`Sidebar`) — same chrome as Project Status and every other tab. There is no private SoS sidebar.

```
Shared Sidebar (team picker + page nav)
SoS Summary
├── Page header + Email SoS button + Refresh All button
└── [For each active release, ordered newest first]
    └── Release section (collapsible, default open)
        ├── Release header: name + gate date strip (CCM / CG / PG / GA) + RAG chip
        ├── Features subsection (collapsible, default open)
        │   └── Table: Key | Summary | Status | Risk | CC Date | CG Date | PG Date | Assignee | AI Exec Summary | Task Breakdown
        │       CC/CG/PG use formatDateWithHistory (current date, then each earlier hop struck through)
        ├── Initiatives subsection (collapsible, default open)
        │   └── Same table columns as Features
        └── KPIs subsection (lazy-loaded on section expand)
            ├── Count KPIs: chip with count + JIRA deep-link
            └── List KPIs: paginated 5-row table + JIRA deep-link
└── Email SoS confirm dialog (To/CC from status-sender config, then Send)
```

### Loading states

- Page load shows a spinner while the dataset cache (or live JIRA on Refresh All) is in flight.
- Task breakdowns load independently after the main items load (same pattern as Project Status).
- KPI widgets load lazily when the KPI subsection is first expanded.
- AI exec summaries are generated on demand (click Generate on each row) or auto-generated in bulk (toolbar button).

### Error states

- If JIRA is unreachable for a release: show inline error with Retry button.
- If a release has no Features or Initiatives: show "No Feature/Initiative tickets found for this release."
- If AI service is unavailable: ExecSummaryCell falls back to showing raw status update date (existing behaviour).

## Permissions

- **View**: `release_versions_view` (same as Project Status)
- **Send email**: `email_send_generic` (same as Generic Emailer)

## Edge Cases

1. If `sosBaseFilter` is not configured for the active team, show an admin warning banner and fall back to `sprintBaseFilter`.
2. If a release has more than 500 Features/Initiatives (pagination cap), show a warning count.
3. KPI widgets that fail to resolve their JIRA filter show a "Filter not found" state without breaking the rest of the page.
4. Email SoS is disabled while the page is still loading or has no items. Confirm dialog shows the resolved To/CC before send.
5. The `customfield_23073` (Status Update) raw text is fetched but never rendered directly to the user — it is passed to the AI exec summary pipeline only.
6. Send does not call JIRA. Corporate SMTP rejects non-`@nutanix.com` addresses (including gmail.com).

## Acceptance Criteria

- [ ] All active releases appear in one view without any user selection required
- [ ] Features and Initiatives render in separate subsections per release
- [ ] AI exec summary generates correctly using the same pipeline as Project Status
- [ ] Task breakdown displays using the same `TaskBreakdownCell` as Project Status
- [ ] KPI widgets load and link to correct JIRA queries
- [ ] Email SoS button appears for users with `email_send_generic`
- [ ] Confirm dialog lists status-sender To (`emailConfig.defaultTo`) and CC (`emailSenderCCConfig.defaultCC` + sender)
- [ ] Send uses already-loaded page data — no `/api/jira/sos-items` (or other JIRA) call on click
- [ ] Email sends successfully via existing SMTP relay
- [ ] No `localhost` in any API call
- [ ] `customfield_23073` is never displayed raw in the UI
