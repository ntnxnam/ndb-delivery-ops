/**
 * ProjectBreakdownMatrix — displays FEAT projects vs issue type groups
 * in a matrix showing outstanding/toVerify/closed counts per cell.
 *
 * Rows: FEAT projects (sorted by total outstanding + toVerify descending)
 * Columns: 6 issue type groups
 * Cells: outstanding | verify | closed counts
 *
 * Fetches real project breakdown data from server endpoint.
 */

import React, { useMemo } from 'react';
import { SectionPanel } from '../../design-system';

// Color palette for issue type groups (consistent with issue-type-grouping.mdc)
const GROUP_COLORS = {
  'Project Hierarchy': '#9467bd',
  'Bug': '#d62728',
  'Improvement': '#ff7f0e',
  'Dev Code': '#1f77b4',
  'Test': '#2ca02c',
  'Everything Else': '#7f7f7f',
};

// Status color mapping
const STATUS_COLORS = {
  outstanding: '#d62728', // red
  toVerify: '#ff7f0e',    // orange
  closed: '#2ca02c',      // green
};

export function ProjectBreakdownMatrix({ projectBreakdown, selectedRelease, loading }) {
  const sectionData = useMemo(() => {
    const toRows = (items) => {
      const rows = (items || []).map((project) => {
        const groups = (project.issueTypeGroups || []).map((group) => ({
          label: group.label,
          outstanding: group.outstanding || 0,
          toVerify: group.toVerify || 0,
          closed: group.closed || 0,
          total: group.total || 0,
          color: GROUP_COLORS[group.label] || '#ccc',
        }));
        const totalOutstanding = groups.reduce((sum, g) => sum + g.outstanding, 0);
        const totalToVerify = groups.reduce((sum, g) => sum + g.toVerify, 0);
        const totalClosed = groups.reduce((sum, g) => sum + g.closed, 0);
        const grandTotal = totalOutstanding + totalToVerify + totalClosed;
        return {
          projectKey: project.projectKey,
          projectName: project.projectName,
          groups,
          totalOutstanding,
          totalToVerify,
          totalClosed,
          grandTotal,
          pctDone: grandTotal > 0 ? ((totalClosed / grandTotal) * 100).toFixed(1) : '0.0',
        };
      });
      rows.sort((a, b) => (b.totalOutstanding + b.totalToVerify) - (a.totalOutstanding + a.totalToVerify));
      return rows;
    };

    const projectRows = toRows(projectBreakdown?.projects || []);
    const standaloneEpicRows = toRows(projectBreakdown?.standaloneEpics || []);
    const standaloneTicketRows = toRows(
      projectBreakdown?.standaloneTickets ? [projectBreakdown.standaloneTickets] : []
    );

    return {
      projectRows,
      standaloneEpicRows,
      standaloneTicketRows,
    };
  }, [projectBreakdown]);

  if (loading) {
    return (
      <SectionPanel
        title="Project Completion Matrix"
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
        title="Project Completion Matrix"
        caption={selectedRelease ? 'No projects found.' : 'No data available.'}
      >
        <div style={{ color: '#666', fontSize: '0.9rem', padding: '1rem' }}>
          No project data available.
        </div>
      </SectionPanel>
    );
  }

  // Compute grand totals across all tiers.
  const allRows = [
    ...sectionData.projectRows,
    ...sectionData.standaloneEpicRows,
    ...sectionData.standaloneTicketRows,
  ];
  const grandTotalOutstanding = allRows.reduce((sum, r) => sum + r.totalOutstanding, 0);
  const grandTotalVerify = allRows.reduce((sum, r) => sum + r.totalToVerify, 0);
  const grandTotalClosed = allRows.reduce((sum, r) => sum + r.totalClosed, 0);
  const grandTotal = grandTotalOutstanding + grandTotalVerify + grandTotalClosed;

  return (
    <SectionPanel
      title="Project Completion Matrix"
      caption={selectedRelease ? `Projects, standalone epics, and standalone tickets for ${selectedRelease}` : 'Loading…'}
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

      <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            <tr style={{ borderTop: '2px solid #333', backgroundColor: '#f5f5f5', fontWeight: 600 }}>
              <td style={{ padding: '0.75rem', color: '#333' }}>TOTAL</td>
              <td style={{ padding: '0.75rem', textAlign: 'center', color: STATUS_COLORS.outstanding }}>
                {grandTotalOutstanding.toLocaleString()}
              </td>
              <td style={{ padding: '0.75rem', textAlign: 'center', color: STATUS_COLORS.toVerify }}>
                {grandTotalVerify.toLocaleString()}
              </td>
              <td style={{ padding: '0.75rem', textAlign: 'center', color: STATUS_COLORS.closed }}>
                {grandTotalClosed.toLocaleString()}
              </td>
              <td
                style={{
                  padding: '0.75rem',
                  textAlign: 'center',
                  color:
                    grandTotal > 0
                      ? ((grandTotalClosed / grandTotal) * 100).toFixed(1) >= 80
                        ? STATUS_COLORS.closed
                        : ((grandTotalClosed / grandTotal) * 100).toFixed(1) >= 50
                        ? STATUS_COLORS.toVerify
                        : STATUS_COLORS.outstanding
                      : '#666',
                }}
              >
                {grandTotal > 0 ? ((grandTotalClosed / grandTotal) * 100).toFixed(1) : '0.0'}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#666', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: STATUS_COLORS.outstanding, borderRadius: '2px' }} />
          Outstanding
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: STATUS_COLORS.toVerify, borderRadius: '2px' }} />
          To Verify
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: STATUS_COLORS.closed, borderRadius: '2px' }} />
          Closed
        </div>
      </div>
    </SectionPanel>
  );
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
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.85rem',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #333', backgroundColor: '#1a1a1a', color: '#fff' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, minWidth: '150px' }}>
                Project
              </th>
              <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '110px' }}>
                Outstanding
              </th>
              <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '110px' }}>
                To Verify
              </th>
              <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, width: '90px' }}>
                Closed
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
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666' }}>
                      {row.projectKey}
                    </span>
                    <span>{row.projectName}</span>
                  </div>
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'center', color: STATUS_COLORS.outstanding, fontWeight: 600 }}>
                  {row.totalOutstanding.toLocaleString()}
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'center', color: STATUS_COLORS.toVerify, fontWeight: 600 }}>
                  {row.totalToVerify.toLocaleString()}
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'center', color: STATUS_COLORS.closed, fontWeight: 600 }}>
                  {row.totalClosed.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: 600,
                    color:
                      row.pctDone >= 80
                        ? STATUS_COLORS.closed
                        : row.pctDone >= 50
                        ? STATUS_COLORS.toVerify
                        : STATUS_COLORS.outstanding,
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
