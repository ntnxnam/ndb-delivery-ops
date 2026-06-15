import React, { useMemo } from 'react';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { useTeamDataset } from '../hooks/useTeamDataset';
import { useRetrospective } from './hooks/useRetrospective';
import { deriveQualityMetricsFromBundle } from './utils/bundleUtils';
import { jiraSearchUrl } from './services/retrospectiveService';
import { GateTimelineRuler } from './components/GateTimelineRuler';
import { GateComplianceCard } from './components/GateComplianceCard';
import { NaughtyListTable, ReopenQualityPanel } from './components/NaughtyListTable';
import { CompanionReadinessPanel } from './components/CompanionReadinessPanel';
import { PgToGaPanel } from './components/PgToGaPanel';
import { SectionPanel } from '../design-system';
import './RetrospectivePage.css';
import './ReleaseBriefPage.css';

function gateCardData(retro, jiraBaseUrl) {
  const checks = retro?.gateChecks || null;
  // When no checks data is available yet, use '—' placeholders so the user
  // can distinguish "still loading" from a genuine zero count.
  const val = (v) => (checks == null ? '—' : v);
  return [
    {
      title: 'CCM',
      contract: 'Task + Unit Test should be closed by code complete',
      metrics: [
        {
          label: 'Open at gate',
          value: val(checks?.ccm?.openAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.ccm?.links?.openAtGate),
          rag: checks?.ccm?.rag,
        },
        {
          label: 'Closed %',
          value: checks == null ? '—' : `${checks?.ccm?.closedPct ?? 0}%`,
          href: jiraSearchUrl(jiraBaseUrl, checks?.ccm?.links?.total),
        },
      ],
    },
    {
      title: 'CG',
      contract: 'P0/P1 bugs should be closed by commit gate',
      metrics: [
        {
          label: 'P0/P1 open at gate',
          value: val(checks?.cg?.p0p1OpenAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.cg?.links?.p0p1OpenAtGate),
          rag: checks?.cg?.ragOpen,
        },
        {
          label: 'P0/P1 found after gate',
          value: val(checks?.cg?.p0p1FoundAfter ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.cg?.links?.p0p1FoundAfter),
          rag: checks?.cg?.ragAfter,
        },
      ],
    },
    {
      title: 'PG',
      contract: 'Tests and bugs should be closed or deferred',
      metrics: [
        {
          label: 'Tests open at gate',
          value: val(checks?.pg?.testsOpenAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.pg?.links?.testsOpenAtGate),
          rag: checks?.pg?.ragTests,
        },
        {
          label: 'Bugs open at gate',
          value: val(checks?.pg?.bugsOpenAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.pg?.links?.bugsOpenAtGate),
          rag: checks?.pg?.ragBugs,
        },
      ],
    },
    {
      title: 'GA',
      contract: 'All release work should be closed by GA',
      metrics: [
        {
          label: 'Open at gate',
          value: val(checks?.ga?.openAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.ga?.links?.openAtGate),
          rag: checks?.ga?.rag,
        },
      ],
    },
  ];
}

function _StatusPill({ value }) {
  if (!value) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  const MAP = {
    on_time_or_early: { label: 'On time / Early', cls: 'success' },
    slipped: { label: 'Slipped', cls: 'danger' },
    at_risk: { label: 'At risk', cls: 'warning' },
    not_complete: { label: 'Not complete', cls: 'muted' },
    code_complete: { label: 'Code complete', cls: 'success' },
  };
  const { label, cls } = MAP[value] || { label: value.replace(/_/g, ' '), cls: 'muted' };
  return <span className={`retro-status-pill retro-status-pill--${cls}`}>{label}</span>;
}

function fmt(dateStr) {
  if (!dateStr || dateStr === '-') return '—';
  return dateStr;
}

/** Slip in days: actual - planned. Null if either date missing. */
function computeSlip(actualDate, plannedDate) {
  if (!actualDate || !plannedDate) return null;
  const a = new Date(`${actualDate}T00:00:00Z`).getTime();
  const p = new Date(`${plannedDate}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(p)) return null;
  return Math.round((a - p) / (24 * 60 * 60 * 1000));
}

export default function RetrospectivePage() {
  const { selectedTeamId, teams } = useTeam();
  const { jiraBaseUrl } = useJiraConfig();
  const { bundle } = useTeamDataset();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || '';
  const team = teams?.find((t) => t.id === selectedTeamId);

  const {
    ready,
    versions,
    bootstrap,
    projectsPage,
    selectedProjectKey,
    selectProject,
    projectDetail,
    retroFallback,
    selectedRelease,
    setSelectedRelease,
    loading,
    loadingBootstrap,
    loadingProjects,
    loadingDetail,
    error,
    refresh,
  } = useRetrospective({
    teamId: selectedTeamId,
    jiraToken,
    username,
    productId: team?.id || 'ndb',
    topN: 10,
  });

  // Gate compliance data always comes from bootstrap (release-level, standalone epics + tickets only).
  // Row selection in the table does NOT change the gate compliance cards.
  // projectDetail is used for other panels below, not for gate cards.
  const retro = useMemo(() => {
    if (bootstrap?.gateChecks) {
      return {
        gateChecks: bootstrap.gateChecks,
        companionReadiness: null,
        pgToGa: null,
        gateTimeline: bootstrap?.gateTimeline,
      };
    }
    return retroFallback;
  }, [bootstrap, retroFallback]);

  const cards = useMemo(() => gateCardData(retro, jiraBaseUrl), [retro, jiraBaseUrl]);

  const companionWithUrls = useMemo(() => {
    const rows = retro?.companionReadiness?.rows || [];
    return rows.map((r) => ({
      ...r,
      links: {
        openAtPg: jiraSearchUrl(jiraBaseUrl, r.links?.openAtPg),
        openAtGa: jiraSearchUrl(jiraBaseUrl, r.links?.openAtGa),
      },
    }));
  }, [retro, jiraBaseUrl]);

  const qualityMetrics = useMemo(
    () => deriveQualityMetricsFromBundle(bundle, selectedRelease),
    [bundle, selectedRelease]
  );

  const naughtyWithUrls = useMemo(() => {
    const rows = retro?.naughtyList?.rows || [];
    return {
      ...retro?.naughtyList,
      rows: rows.map((r) => ({
        ...r,
        links: {
          ccmSlip: jiraSearchUrl(jiraBaseUrl, r.links?.ccmSlip),
          cgOpenAtGate: jiraSearchUrl(jiraBaseUrl, r.links?.cgOpenAtGate),
          cgFoundAfter: jiraSearchUrl(jiraBaseUrl, r.links?.cgFoundAfter),
          pgTests: jiraSearchUrl(jiraBaseUrl, r.links?.pgTests),
          pgBugs: jiraSearchUrl(jiraBaseUrl, r.links?.pgBugs),
          deferredCount: jiraSearchUrl(jiraBaseUrl, r.links?.deferredCount),
        },
      })),
    };
  }, [retro, jiraBaseUrl]);

  const pgToGaWithUrls = useMemo(
    () => ({
      ...retro?.pgToGa,
      links: {
        closedInWindow: jiraSearchUrl(jiraBaseUrl, retro?.pgToGa?.links?.closedInWindow),
        deferredInWindow: jiraSearchUrl(jiraBaseUrl, retro?.pgToGa?.links?.deferredInWindow),
      },
    }),
    [retro, jiraBaseUrl]
  );

  return (
    <div className="ds-scope">
      <div className="ds-page">
        <div className="ds-page__inner retrospective-page">
          <div className="retro-header">
            <div>
              <h2>Release Retrospective</h2>
              <div className="retro-hint">Team: {team?.name || 'NDB'}</div>
            </div>
            <div className="retro-actions">
              <label htmlFor="retro-release-select">Release</label>
              <select
                id="retro-release-select"
                value={selectedRelease || ''}
                onChange={(e) => setSelectedRelease(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button onClick={refresh} type="button" disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>

          {error ? <div className="rb-error">{error}</div> : null}
          {!ready ? (
            <div className="rb-empty">Pick a team in the header to load retrospective data.</div>
          ) : null}

          <SectionPanel
            title="Gate Timeline"
            subtitle={`EC, CCM, CG, PG, GA${bootstrap?.parentCount ? ` · ${bootstrap.parentCount} projects` : ''}`}
          >
            {loadingBootstrap ? (
              <div className="rb-empty">Loading bootstrap...</div>
            ) : (
              <GateTimelineRuler gateTimeline={bootstrap?.gateTimeline} />
            )}
          </SectionPanel>

          <SectionPanel title="Projects — Gate Health" subtitle="CC = Tasks+UnitTests · CG = P0/P1 Bugs+Improvements · PG = All Bugs+Improvements+Tests">
            {loadingProjects ? (
              <div className="rb-empty">Loading projects...</div>
            ) : (
              <div className="retro-table-wrap">
                <table className="retro-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Summary</th>
                      <th>Type</th>
                      <th title="Code Complete Met: Tasks/Unit Tests. Shows slip in days and count of ERA vs other tickets closed after planned date">CCM</th>
                      <th title="Commit Gate: P0/P1 Bugs/Improvements. Shows slip in days and count of ERA vs other tickets resolved after planned date">CG</th>
                      <th title="Promotion Gate: All Bugs/Improvements/Tests. Shows slip in days and count of ERA vs other tickets resolved after planned date">PG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(projectsPage?.projects || []).map((p) => {
                      const gd = bootstrap?.gateDates || {};

                      // Helper: Build consolidated gate cell with slip + breakdown
                      const buildGateCell = (slip, eraCount, nonEraCount, slipJql, tooltip) => {
                        if (slip == null) return { label: '—', color: 'var(--ds-muted)' };
                        if (slip === 0) return { label: '✓', color: 'var(--ds-success)' };
                        const color = slip > 0 ? 'var(--ds-danger)' : 'var(--ds-success)';
                        const slipLabel = slip > 0 ? `+${slip}d` : `${slip}d`;
                        const breakdown = eraCount > 0 || nonEraCount > 0
                          ? ` (${eraCount > 0 ? eraCount + ' ERA' : ''}${eraCount > 0 && nonEraCount > 0 ? ', ' : ''}${nonEraCount > 0 ? nonEraCount + ' other' : ''})`
                          : '';
                        return {
                          label: slipLabel + breakdown,
                          color,
                          jql: slipJql,
                          tooltip,
                          isDelayed: slip > 0,
                        };
                      };

                      // CCM slip: actual last-closed Task/UnitTest vs the release-level CCM gate date.
                      // CG/PG slips already use gd.cgDate / gd.pgDate — CCM follows the same pattern.
                      // We do NOT use customfield_11067 (the per-FEAT "CC Date" field); that is the
                      // team's self-set date and has no meaning for gate compliance tracking.
                      const ccmSlip = computeSlip(p.ccm?.lastClosedDate, gd.ccmDate);
                      const ccmSlipTooltip = ccmSlip == null
                        ? 'No Task/Unit Test closed date available'
                        : ccmSlip > 0
                        ? `⚠ Last Task/Unit Test closed ${p.ccm?.lastClosedDate} — ${ccmSlip} day${ccmSlip !== 1 ? 's' : ''} after the CCM gate (planned ${gd.ccmDate}). ${p.ccm?.openEra || 0} ERA and ${p.ccm?.openNonEra || 0} other tickets still open.`
                        : ccmSlip < 0
                        ? `✓ Last Task/Unit Test closed ${p.ccm?.lastClosedDate} — ${Math.abs(ccmSlip)} day${Math.abs(ccmSlip) !== 1 ? 's' : ''} before the CCM gate (planned ${gd.ccmDate}). Coding done on time.`
                        : `Last Task/Unit Test closed exactly on the CCM gate date (${gd.ccmDate}).`;
                      const ccmSlipJql = ccmSlip != null && gd.ccmDate && p.links?.ccmOpen
                        ? `${p.links.ccmOpen} AND status was not in (Resolved, Closed, Done) ON "${gd.ccmDate}"`
                        : null;
                      const ccmCell = buildGateCell(ccmSlip, p.ccm?.openEra || 0, p.ccm?.openNonEra || 0, ccmSlipJql, ccmSlipTooltip);

                      // CG slip: last P0/P1 bug resolved vs planned CG date
                      const cgSlip = computeSlip(p.cg?.lastResolvedDate, gd.cgDate);
                      const cgSlipTooltip = cgSlip == null
                        ? p.cg?.done === 0 ? 'No P0/P1 bugs found for this project' : 'No P0/P1 bug resolution date available'
                        : cgSlip > 0
                        ? `⚠ Last P0/P1 bug resolved ${p.cg?.lastResolvedDate} — ${cgSlip} day${cgSlip !== 1 ? 's' : ''} after the CG gate (planned ${gd.cgDate}). ${p.cg?.openEra || 0} ERA and ${p.cg?.openNonEra || 0} other P0/P1 bugs still open.`
                        : cgSlip < 0
                        ? `✓ Last P0/P1 bug resolved ${p.cg?.lastResolvedDate} — ${Math.abs(cgSlip)} day${Math.abs(cgSlip) !== 1 ? 's' : ''} before the CG gate (planned ${gd.cgDate}). All critical bugs resolved on time.`
                        : `Last P0/P1 bug resolved exactly on the CG gate date (${gd.cgDate}).`;
                      const cgSlipJql = cgSlip != null && gd.cgDate && p.links?.cgOpen
                        ? `${p.links.cgOpen} AND status was not in (Resolved, Closed, Done) ON "${gd.cgDate}"`
                        : null;
                      const cgCell = buildGateCell(cgSlip, p.cg?.openEra || 0, p.cg?.openNonEra || 0, cgSlipJql, cgSlipTooltip);

                      // PG slip: last bug/test resolved vs planned PG date
                      const pgSlip = computeSlip(p.pg?.lastResolvedDate, gd.pgDate);
                      const pgSlipTooltip = pgSlip == null
                        ? p.pg?.done === 0 ? 'No bugs or tests found for this project' : 'No bug/test resolution date available'
                        : pgSlip > 0
                        ? `⚠ Last bug/test resolved ${p.pg?.lastResolvedDate} — ${pgSlip} day${pgSlip !== 1 ? 's' : ''} after the PG gate (planned ${gd.pgDate}). ${p.pg?.openEra || 0} ERA and ${p.pg?.openNonEra || 0} other bugs/tests still open.`
                        : pgSlip < 0
                        ? `✓ Last bug/test resolved ${p.pg?.lastResolvedDate} — ${Math.abs(pgSlip)} day${Math.abs(pgSlip) !== 1 ? 's' : ''} before the PG gate (planned ${gd.pgDate}). All quality work resolved on time.`
                        : `Last bug/test resolved exactly on the PG gate date (${gd.pgDate}).`;
                      const pgSlipJql = pgSlip != null && gd.pgDate && p.links?.pgOpen
                        ? `${p.links.pgOpen} AND status was not in (Resolved, Closed, Done) ON "${gd.pgDate}"`
                        : null;
                      const pgCell = buildGateCell(pgSlip, p.pg?.openEra || 0, p.pg?.openNonEra || 0, pgSlipJql, pgSlipTooltip);

                      return (
                        <tr
                          key={p.key}
                          className={selectedProjectKey === p.key ? 'retro-row-selected' : ''}
                          onClick={() => selectProject(p.key)}
                        >
                          <td style={{ color: 'var(--ds-accent)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            <a
                              href={jiraBaseUrl ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${p.key}` : undefined}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: 'inherit', textDecoration: 'none' }}
                              title={`Open ${p.key} in JIRA`}
                            >
                              {p.key}
                            </a>
                          </td>
                          <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.summary}>{p.summary}</td>
                          <td style={{ color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>{p.parentType}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmt(gd.ccmDate)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmt(p.ccm?.lastClosedDate)}</td>
                          <td style={{ color: ccmSlipColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: ccmSlip != null ? 'pointer' : 'default' }} title={ccmSlipTooltip}>
                            {ccmSlip != null && ccmSlipJql ? (
                              <a
                                href={jiraSearchUrl(jiraBaseUrl, ccmSlipJql)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: 'inherit', textDecoration: 'none' }}
                                title={ccmSlipTooltip}
                              >
                                {ccmSlipLabel}
                              </a>
                            ) : (
                              ccmSlipLabel
                            )}
                          </td>
                          <td style={{ color: p.ccm?.openEra > 0 || p.ccm?.openNonEra > 0 ? 'var(--ds-warning)' : 'var(--ds-muted)', textAlign: 'center', fontSize: '0.9em' }}>
                            {p.ccm?.openEra > 0 || p.ccm?.openNonEra > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {p.ccm?.openEra > 0 ? (
                                  <a
                                    href={jiraSearchUrl(jiraBaseUrl, p.links?.ccmOpenEra)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ds-danger)', fontWeight: 'bold', textDecoration: 'none' }}
                                    title="ERA tasks/unit tests currently open"
                                  >
                                    {p.ccm.openEra} ERA
                                  </a>
                                ) : null}
                                {p.ccm?.openNonEra > 0 ? (
                                  <a
                                    href={jiraSearchUrl(jiraBaseUrl, p.links?.ccmOpenNonEra)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ds-warning)', textDecoration: 'none' }}
                                    title="Non-ERA tasks/unit tests currently open"
                                  >
                                    {p.ccm.openNonEra} other
                                  </a>
                                ) : null}
                              </div>
                            ) : p.ccm?.done > 0 ? '✓' : '—'}
                          </td>
                          <td style={{ color: p.cg?.openEra > 0 || p.cg?.openNonEra > 0 ? 'var(--ds-danger)' : 'var(--ds-muted)', textAlign: 'center', fontSize: '0.9em' }}>
                            {p.cg?.openEra > 0 || p.cg?.openNonEra > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {p.cg?.openEra > 0 ? (
                                  <a
                                    href={jiraSearchUrl(jiraBaseUrl, p.links?.cgOpenEra)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ds-danger)', fontWeight: 'bold', textDecoration: 'none' }}
                                    title="ERA P0/P1 bugs currently open"
                                  >
                                    {p.cg.openEra} ERA
                                  </a>
                                ) : null}
                                {p.cg?.openNonEra > 0 ? (
                                  <a
                                    href={jiraSearchUrl(jiraBaseUrl, p.links?.cgOpenNonEra)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ds-warning)', textDecoration: 'none' }}
                                    title="Non-ERA P0/P1 bugs currently open"
                                  >
                                    {p.cg.openNonEra} other
                                  </a>
                                ) : null}
                              </div>
                            ) : p.cg?.done > 0 ? '✓' : '—'}
                          </td>
                          <td style={{ color: cgSlipColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: cgSlip != null ? 'pointer' : 'default' }} title={cgSlipTooltip}>
                            {cgSlip != null && cgSlipJql ? (
                              <a
                                href={jiraSearchUrl(jiraBaseUrl, cgSlipJql)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: 'inherit', textDecoration: 'none' }}
                                title={cgSlipTooltip}
                              >
                                {cgSlipLabel}
                              </a>
                            ) : (
                              cgSlipLabel
                            )}
                          </td>
                          <td style={{ color: p.pg?.openEra > 0 || p.pg?.openNonEra > 0 ? 'var(--ds-warning)' : 'var(--ds-muted)', textAlign: 'center', fontSize: '0.9em' }}>
                            {p.pg?.openEra > 0 || p.pg?.openNonEra > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {p.pg?.openEra > 0 ? (
                                  <a
                                    href={jiraSearchUrl(jiraBaseUrl, p.links?.pgOpenEra)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ds-danger)', fontWeight: 'bold', textDecoration: 'none' }}
                                    title="ERA bugs/tests currently open"
                                  >
                                    {p.pg.openEra} ERA
                                  </a>
                                ) : null}
                                {p.pg?.openNonEra > 0 ? (
                                  <a
                                    href={jiraSearchUrl(jiraBaseUrl, p.links?.pgOpenNonEra)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--ds-warning)', textDecoration: 'none' }}
                                    title="Non-ERA bugs/tests currently open"
                                  >
                                    {p.pg.openNonEra} other
                                  </a>
                                ) : null}
                              </div>
                            ) : p.pg?.done > 0 ? '✓' : '—'}
                          </td>
                          <td style={{ color: pgSlipColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: pgSlip != null ? 'pointer' : 'default' }} title={pgSlipTooltip}>
                            {pgSlip != null && pgSlipJql ? (
                              <a
                                href={jiraSearchUrl(jiraBaseUrl, pgSlipJql)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: 'inherit', textDecoration: 'none' }}
                                title={pgSlipTooltip}
                              >
                                {pgSlipLabel}
                              </a>
                            ) : (
                              pgSlipLabel
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!projectsPage?.projects?.length ? (
                      <tr>
                        <td colSpan={11}>No projects found for this release.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </SectionPanel>

          {/* Scope label: always shows release-level gate compliance (standalone epics + tickets) */}
          <div className="retro-hint" style={{ marginBottom: 8, marginTop: 16 }}>
            {loadingBootstrap
              ? `Loading gate compliance for: ${selectedRelease}…`
              : bootstrap?.gateChecks
              ? `Gate compliance for: standalone epics & tickets · ${selectedRelease}`
              : null}
          </div>

          <div className="retro-grid">
            {cards.map((c) => (
              <GateComplianceCard key={c.title} {...c} />
            ))}
          </div>

          {loadingBootstrap ? (
            <div className="rb-empty" style={{ textAlign: 'center', marginTop: 8 }}>
              Loading release gate checks…
            </div>
          ) : loadingDetail ? (
            <div className="rb-empty" style={{ textAlign: 'center', marginTop: 8 }}>
              Loading project detail…
            </div>
          ) : null}

          {retroFallback ? <NaughtyListTable naughtyList={naughtyWithUrls} /> : null}
          <ReopenQualityPanel qualityMetrics={qualityMetrics} />
          {retroFallback ? (
            <CompanionReadinessPanel
              companionReadiness={{ ...retro?.companionReadiness, rows: companionWithUrls }}
            />
          ) : null}
          {retroFallback ? <PgToGaPanel pgToGa={pgToGaWithUrls} /> : null}
        </div>
      </div>
    </div>
  );
}
