import React from 'react';

const JIRA_BASE = 'https://jira.nutanix.com';

function linked(value, href) {
  if (!href) return value;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

/**
 * ReopenQualityPanel — bundle-driven panel showing how many times
 * Bug/Improvement/Test tickets were reopened per project for a release.
 *
 * Props:
 *   qualityMetrics — result of deriveQualityMetricsFromBundle()
 */
export function ReopenQualityPanel({ qualityMetrics }) {
  if (!qualityMetrics) return null;
  const {
    totalQualityTickets,
    bugsReopened,
    totalReopens,
    avgReopensPerTicket,
    maxReopens,
    perProject,
  } = qualityMetrics;

  const reopenRate = totalQualityTickets > 0
    ? Math.round((bugsReopened / totalQualityTickets) * 100)
    : 0;

  return (
    <div className="retro-panel">
      <h3>Reopen Quality Signals</h3>
      <p className="retro-hint">
        Bug / Improvement / Test tickets reopened (transitioned from Resolved or Closed back to open)
        during this release. Higher reopen count = poor fix quality or insufficient test coverage.
      </p>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Quality Tickets', value: totalQualityTickets },
          { label: 'Reopened', value: `${bugsReopened} (${reopenRate}%)` },
          { label: 'Total Reopen Events', value: totalReopens },
          { label: 'Avg Reopens / Ticket', value: avgReopensPerTicket },
          { label: 'Max Reopens (single ticket)', value: maxReopens },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: 'var(--ds-surface-raised, #1e2230)',
            border: '1px solid var(--ds-border, #2a2f45)',
            borderRadius: '6px',
            padding: '0.5rem 0.9rem',
            minWidth: '9rem',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--ds-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--ds-text-strong)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Per-project table */}
      {perProject.length > 0 && (
        <div className="retro-table-wrap">
          <table className="retro-table">
            <thead>
              <tr>
                <th>Project</th>
                <th style={{ textAlign: 'right' }}>Quality Tickets</th>
                <th style={{ textAlign: 'right' }}>Reopened</th>
                <th style={{ textAlign: 'right' }}>Total Reopens</th>
                <th>Worst Offender</th>
              </tr>
            </thead>
            <tbody>
              {perProject.map((p) => (
                <tr key={p.projectKey}>
                  <td>
                    <a href={`${JIRA_BASE}/browse/${p.projectKey}`} target="_blank" rel="noreferrer">
                      {p.projectKey}
                    </a>
                  </td>
                  <td style={{ textAlign: 'right' }}>{p.bugCount}</td>
                  <td style={{ textAlign: 'right' }}>{p.bugsReopened}</td>
                  <td style={{ textAlign: 'right', fontWeight: p.totalReopens >= 5 ? 700 : undefined,
                    color: p.totalReopens >= 5 ? 'var(--ds-danger, #e74c3c)' : undefined }}>
                    {p.totalReopens}
                  </td>
                  <td>
                    {p.worstBugKey ? (
                      <>
                        <a href={`${JIRA_BASE}/browse/${p.worstBugKey}`} target="_blank" rel="noreferrer">
                          {p.worstBugKey}
                        </a>
                        {' '}
                        <span style={{ color: 'var(--ds-muted)', fontSize: '0.8em' }}>
                          ({p.worstBugReopens}×)
                        </span>
                      </>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function NaughtyListTable({ naughtyList }) {
  const rows = naughtyList?.rows || [];
  const weights = naughtyList?.weights || {};

  return (
    <div className="retro-panel">
      <h3>Naughty Projects</h3>
      <p className="retro-hint">
        score = cgOpenAtGate*{weights.cgOpenAtGate || 10} + cgFoundAfter*
        {weights.cgFoundAfter || 8} + pgBugs*{weights.pgBugs || 6} + deferred*
        {weights.deferredCount || 5} + pgTests*{weights.pgTests || 4} + ccmSlip*
        {weights.ccmSlip || 2}
      </p>
      <div className="retro-table-wrap">
        <table className="retro-table">
          <thead>
            <tr>
              <th>Parent</th>
              <th>Type</th>
              <th>CCM</th>
              <th>CG Open</th>
              <th>CG Late</th>
              <th>PG Tests</th>
              <th>PG Bugs</th>
              <th>Deferred</th>
              <th>Score</th>
              <th>RAG</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No rows.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.parentKey}>
                  <td>{r.parentKey}</td>
                  <td>{r.parentType}</td>
                  <td>{linked(r.ccmSlip, r.links?.ccmSlip)}</td>
                  <td>{linked(r.cgOpenAtGate, r.links?.cgOpenAtGate)}</td>
                  <td>{linked(r.cgFoundAfter, r.links?.cgFoundAfter)}</td>
                  <td>{linked(r.pgTests, r.links?.pgTests)}</td>
                  <td>{linked(r.pgBugs, r.links?.pgBugs)}</td>
                  <td>{linked(r.deferredCount, r.links?.deferredCount)}</td>
                  <td>{r.score}</td>
                  <td>{r.rag}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
