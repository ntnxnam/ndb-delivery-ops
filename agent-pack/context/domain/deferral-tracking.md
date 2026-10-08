# Deferral Tracking System

This document defines how deferrals are detected, classified, analyzed, and escalated across Component and Release reports.

## Core Concepts

### Deferral
A **deferral** = ticket's fixVersion changed via JIRA changelog.

Types:
- **Normal deferral** (1x): Moved once between releases (expected, planned slips)
- **Recurring deferral** (2x): Moved twice (watch pattern)
- **Chronic deferral** (3+ moves): Moved 3+ times (technical debt / systemic issue)

### Chronic Deferral Detection

```javascript
// Pseudocode
function isChronicDeferral(ticket) {
  const fixVersionHistory = getChangelogEntries(ticket, 'fixVersion');
  const distinctVersions = new Set(fixVersionHistory.map(e => e.toString));
  return distinctVersions.size >= 3; // moved 3+ times
}
```

**Example**:
```
ERA-123 fixVersion changelog:
  2024-10-15: NDB-2.8 (initial)
  2024-11-20: NDB-2.9 (kick #1)
  2025-01-10: NDB-2.10 (kick #2)
  2025-03-15: NDB-2.11 (kick #3)
  → CHRONIC (3 distinct release targets)
```

## Alert Severity Classification

### CRITICAL 🔴
- **Condition**: Chronic deferral (3+ kicks) + attached to active KPI
- **Context**: "Recurring blocker preventing feature delivery"
- **Action**: Escalate to EM immediately; requires root cause fix, not another deferral
- **Data source**: KPI label on issue + chronic deferral detection

### HIGH 🟠
- **Condition**: Chronic deferral (3+ kicks) not KPI-attached
- **Context**: "Accumulating technical debt across releases"
- **Pattern insight**: "All chronic bugs in Storage subsystem → systemic infra issue"
- **Action**: Triage for root cause vs. accept debt + reserve sprint capacity
- **Data source**: Deferral count + component subsystem analysis

### MEDIUM 🟡
- **Condition A**: fixVersion anomaly (parent/child mismatch)
  - "Project marked NDB-2.11, 5 children still in master"
  - Action: Data cleanup or replan children
- **Condition B**: Deferral spike (2x normal weekly rate)
  - "Last week: 2 deferrals; this week: 4"
  - Action: Monitor + investigate velocity correlation
- **Data source**: fixVersion consistency check + deferral trending

### LOW 🔵
- **Condition**: Data quality issue
  - affectedVersion IN ("ERA Future", "Triage")
  - Status mismatch (closed project with open children)
- **Action**: Correction needed (data hygiene)

## AI Analysis Rules

### Rule 1: Chronic Deferral Pattern Recognition
```
IF bugs deferred 3+ times in same component
AND all involve same subsystem (e.g., "Storage", "Networking")
THEN insight = "Systemic issue, not scope creep"
RECOMMENDATION = "Investigate root cause; consider redesign"
```

### Rule 2: Velocity Correlation
```
IF deferral count spike this week
AND velocity dropped vs. prior sprint
THEN insight = "Capacity exhaustion, absorbing scope delays"
RECOMMENDATION = "Reassess capacity or scope for next sprint"
```

### Rule 3: KPI Blocking
```
IF chronic deferral (3+ kicks)
AND ticket labeled with active KPI
THEN severity = CRITICAL
RECOMMENDATION = "Escalate; requires non-deferral fix"
```

### Rule 4: Forward Flow Validation
```
IF fixVersion moved backward (e.g., NDB-2.11 → NDB-2.10)
THEN flag = ERROR (impossible, illogical)
ACTION = investigate data integrity
```

## Component Report Deferrals (Widget 6)

**Displays**:
1. **Deferral distribution** (1x, 2x, 3+)
   - Visual: Pie chart or stacked bar
   - Example: "65 not deferred, 20 deferred 1x, 10 deferred 2x, 5 deferred 3+"

2. **Trend chart** (weekly deferral count)
   - X-axis: weeks
   - Y-axis: count of newly deferred items
   - Shows: Is component getting better or worse?

3. **Chronic offenders table** (3+ kicks)
   - Columns: Key, Summary, Kick Count, Original Target, Current Target, Last Moved
   - Sorted by: Kick count descending
   - Flagged: KPI-attached rows highlighted red

4. **AI insights** (inline)
   - Pattern analysis ("All in Storage subsystem")
   - Recommended action with confidence level

## Release Report Deferrals (Future Plan)

**Parallel to Component Report** — same logic, filtered by release instead of component.

**New dimensions**:
- **Deferrals OUT** (work leaving this release for later)
- **Deferrals IN** (work added from earlier releases)
- **Net deferral impact** (out - in)
- **Cross-component deferral patterns** (which components deferring most?)

**Alert tiers**: Same 4 severity levels (CRITICAL, HIGH, MEDIUM, LOW)

## CTA Alert Generation

### Section 1: Filters + AI-Powered CTA Alerts

**Algorithm**:
1. Compute all deferral metrics for selected component
2. Classify into severity buckets (CRITICAL, HIGH, MEDIUM, LOW)
3. Generate AI insight for each bucket
4. Sort by severity; display top N alerts (default: top 4)

**Alert card format**:
```
[Severity Icon] [Count + Bucket Name]
💡 AI Insight: [1-2 sentences explaining pattern]
📋 Recommended Action: [specific next step with confidence]
[Drill-down link] → View Details
```

## Implementation Checklist

- [ ] Changelog query builder (fetch fixVersion movement history)
- [ ] Chronic deferral detector (3+ distinct versions)
- [ ] KPI label matcher (active KPIs linked to issues)
- [ ] Velocity correlation analyzer (spike detection + sprint comparison)
- [ ] AI insight generator (pattern → English summary)
- [ ] Recommendation engine (rule-based action suggestions)
- [ ] CTA alert renderer (Section 1 UI + sorting by severity)
- [ ] Deferral distribution chart (pie/stacked bar)
- [ ] Chronic offenders table (Section 5)
- [ ] Release-level deferral report (Phase 2)

## Never Do

- Do not defer work backward in time (NDB-2.11 → NDB-2.10) — flag as data error
- Do not mark tickets as "no deferral concern" if they have 3+ history changes
- Do not ignore CRITICAL alerts (KPI-blocking chronic deferrals require escalation, not another deferral)
- Do not use deferral count alone to assess component health — always check velocity correlation and pattern context
