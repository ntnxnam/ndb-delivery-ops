/**
 * ProjectBreakdownMatrix — displays FEAT projects vs work streams.
 *
 * Columns: Dev ↑ | QA Verification ↑ | QA Test Tasks ↑ | % Done
 *
 * Stream derivations (per sprint-velocity-types.mdc):
 *   Dev              — outstanding items dev team still needs to fix:
 *                      sum(outstanding) for Bug, Improvement, Dev Code, Everything Else
 *   QA Verification  — fixed by dev, awaiting QA close:
 *                      sum(toVerify) for Bug + Improvement
 *   QA Test Tasks    — open test-case work:
 *                      sum(outstanding + toVerify) for Test group
 *   % Done           — totalClosed / grandTotal × 100
 *
 * No backend change needed — backend already returns per-group
 * outstanding/toVerify/closed; streams are derived client-side.
 */

import React, { useMemo } from 'react';
import { SectionPanel } from '../../design-system';

// Stream colors per sprint-velocity-types.mdc
const STREAM_COLORS = {
  dev: '#1f77b4',           // blue
  qaVerification: '#ff7f0e', // orange
  qaTestTasks: '#2ca02c',    // green
};

const STATUS_COLORS = {
  done: '#2ca02c',
  warn: '#ff7f0e',
  risk: '#d62728',
};

/** Derive the three work streams from a project's issueTypeGroups array. */
function deriveStreams(groups) {
  let dev = 0;
  let qaVerification = 0;
  let qaTestTasks = 0;
  let totalClosed = 0;
  let grandTotal = 0;

  for (const g of groups) {
    const outstanding = g.outstanding || 0;
    const toVerify = g.toVerify || 0;
    const closed = g.closed || 0;
    const total = outstanding + toVerify + closed;

    totalClosed += closed;
    grandTotal += total;

    if (g.label === 'Test') {
      qaTestTasks += outstanding + toVerify;
    } else if (g.label !== 'Project Hierarchy') {
      // Bug, Improvement, Dev Code, Everything Else
      dev += outstanding;
      if (g.label === 'Bug' || g.label === 'Improvement') {
        qaVerification += toVerify;
      }
    }
  }

  return { dev, qaVerification, qaTestTasks, totalClosed, grandTotal };
}

export function ProjectBreakdownMatrix({ projectBreakdown, selectedRelease, loading }) {
  const sectionData = useMemo(() => {
    const toRows = (items) => {
      const rows = (items || []).map((project) => {
        const groups = (project.issueTypeGroups || []);
        const streams = deriveStreams(groups);
        return {
          projectKey: project.projectKey,
          projectName: project.projectName,
          ...streams,
          pctDone:
            streams.grandTotal > 0
              ? ((streams.totalClosed / streams.grandTotal) * 100).toFixed(1)
              : '0.0',
        };
      });
      // Sort: most open work first (dev + qaVerification + qaTestTasks)
      rows.sort(
        (a, b) =>
          b.dev + b.qaVerification + b.qaTestTasks -
          (a.dev + a.qaVerification + a.qaTestTasks)
      );
      return rows;
    };

    return {
      projectRows: toRows(projectBreakdown?.projects || []),
      standaloneEpicRows: toRows(projectBreakdown?.standaloneEpics || []),
      standaloneTicketRows: toRows(
        projectBreakdown?.standaloneTickets ? [projectBreakdown.standaloneTickets] : []
      ),
    };
  }, [projectBreakdown]);

  if (loading) {
    return (
      <SectionPanel
        title="Outstanding Work by Stream"
        caption={selectedRelease ? 'Loading…' : 'No data available.'}
      >
        <div style={{ color: '#666', fontSize: '0.9rem', padding: '1rem' }}>
          Loading project data…
        </div>
      </SectionPanel>
    );
  }

  const totalRows =
    sectionData.projectRows.length +
    sectionData.standaloneEpicRows.length +
    sectionData.standaloneTicketRows.length;

  if (totalRows === 0) {
    return (
      <SectionPanel
        title="Outstanding Work by Stream"
        caption={selectedRelease ? 'No projects found.' : 'No data available.'}
      >
        <div style={{ color: '#666', fontSize: '0.9rem', padding: '1rem' }}>
          No project data available.
        </div>
      </SectionPanel>
    );
  }

  // Grand totals across all tiers for the summary row
  const allRows = [
    ...sectionData.projectRows,
    ...sectionData.standaloneEpicRows,
    ...sectionData.standaloneTicketRows,
  ];
  const grandDev = allRows.reduce((s, r) => s + r.dev, 0);
  const grandQaVerification = allRows.reduce((s, r) => s + r.qaVerification, 0);
  const grandQaTestTasks = allRows.reduce((s, r) => s + r.qaTestTasks, 0);
  const grandTotalClosed = allRows.reduce((s, r) => s + r.totalClosed, 0);
  const grandTotal = allRows.reduce((s, r) => s + r.grandTotal, 0);
  const grandPctDone =
    grandTotal > 0 ? ((grandTotalClosed / grandTotal) * 100).toFixed(1) : '0.0';

  return (
    <SectionPanel
      title="Outstanding Work by Stream"
      caption={
        selectedRelease
          ? `Projects, standalone epics, and standalone tickets for ${selectedRelease}`
          : 'Loading…'
      }
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <ProjectBreakdownSection
          title="Projects (Features / Initiatives)"
          rows={sectionData.projectRows}
        />
        <ProjectBreakdownSection
          title="Standalone Epics"
          rows={sectionData.standaloneEpicRows}
        />
        <ProjectBreakdownSection
          title="Standalone Tickets (no epic)"
          rows={sectionData.standaloneTicketRows}
        />
      </div>

      {/* Grand total row */}
      <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            <tr style={{ borderTop: '2px solid #333', backgroundColor: '#f5f5f5', fontWeight: 600 }}>
              <td style={{ padding: '0.75rem', color: '#333' }}>TOTAL</td>
              <td style={{ padding: '0.75rem', textAlign: 'center', color: STREAM_COLORS.dev }}>
                {grandDev.toLocaleString()}
              </td>
              <td style={{ padding: '0.75rem', textAlign: 'center', color: STREAM_COLORS.qaVerification }}>
                {grandQaVerification.toLocaleString()}
              </td>
              <td style={{ padding: '0.75rem', textAlign: 'center', color: STREAM_COLORS.qaTestTasks }}>
                {grandQaTestTasks.toLocaleString()}
              </td>
              <td
                style={{
                  padding: '0.75rem',
                  textAlign: 'center',
                  color:
                    grandPctDone >= 80
                      ? STATUS_COLORS.done
                      : grandPctDone >= 50
                      ? STATUS_COLORS.warn
                      : STATUS_COLORS.risk,
                }}
              >
                {grandPctDone}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div
        style={{
          marginTop: '1rem',
          fontSize: '0.8rem',
          color: '#666',
          display: 'flex',
          gap: '1.25rem',
          flexWrap: 'wrap',
        }}
      >
        <LegendItem color={STREAM_COLORS.dev} label="Dev — open items dev team needs to fix" />
        <LegendItem
          color={STREAM_COLORS.qaVerification}
          label="QA Verification — fixed by dev, awaiting QA close"
        />
        <LegendItem color={STREAM_COLORS.qaTestTasks} label="QA Test Tasks — open test-case work" />
      </div>
    </SectionPanel>
  );
}

function LegendItem({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <span
        style={{
          display: 'inline-block',
          width: '12px',
          height: '12px',
          backgroundColor: color,
          borderRadius: '2px',
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  );
}

function pctDoneColor(pct) {
  if (pct >= 80) return STATUS_COLORS.done;
  if (pct >= 50) return STATUS_COLORS.warn;
  return STATUS_COLORS.risk;
}

function ProjectBreakdownSection({ title, rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{title}</div>
        <div style={{ color: '#666', fontSize: '0.85rem' }}>No data in this tier.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333', backgroundColor: '#1a1a1a', color: '#fff' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, minWidth: '200px' }}>
                Project
              </th>
              <th
                style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '90px',
                  color: STREAM_COLORS.dev }}
                title="Open items the dev team still needs to fix (Bug, Improvement, Task, Unit Test, Everything Else — outstanding state)"
              >
                Dev ↑
              </th>
              <th
                style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '110px',
                  color: STREAM_COLORS.qaVerification }}
                title="Bug / Improvement items fixed by dev, awaiting QA close (In Review / Testing / Ready for Testing)"
              >
                QA Verify ↑
              </th>
              <th
                style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '110px',
                  color: STREAM_COLORS.qaTestTasks }}
                title="Open Test-type issues (test case writing and execution)"
              >
                QA Tests ↑
              </th>
              <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '80px' }}>
                % Done
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.projectKey}
                style={{
                  borderBottom: '1px solid #e0e0e0',
                  backgroundColor: idx % 2 === 0 ? '#fff' : '#fafafa',
                }}
              >
                <td style={{ padding: '0.75rem', fontWeight: 500, color: '#333' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666', flexShrink: 0 }}>
                      {row.projectKey}
                    </span>
                    <span>{row.projectName}</span>
                  </div>
                </td>
                <td
                  style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: 600,
                    color: row.dev > 0 ? STREAM_COLORS.dev : '#aaa',
                  }}
                >
                  {row.dev > 0 ? row.dev.toLocaleString() : '—'}
                </td>
                <td
                  style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: 600,
                    color: row.qaVerification > 0 ? STREAM_COLORS.qaVerification : '#aaa',
                  }}
                >
                  {row.qaVerification > 0 ? row.qaVerification.toLocaleString() : '—'}
                </td>
                <td
                  style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: 600,
                    color: row.qaTestTasks > 0 ? STREAM_COLORS.qaTestTasks : '#aaa',
                  }}
                >
                  {row.qaTestTasks > 0 ? row.qaTestTasks.toLocaleString() : '—'}
                </td>
                <td
                  style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: 600,
                    color: pctDoneColor(parseFloat(row.pctDone)),
                  }}
                >
                  {row.pctDone}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
