import React from 'react';
import { jiraSearchUrl } from '../services/retrospectiveService';
import { SectionPanel } from '../../design-system';

/** Slip in days: actual - planned. Null if either date missing. */
function computeSlip(actualDate, plannedDate) {
  if (!actualDate || !plannedDate) return null;
  const a = new Date(`${actualDate}T00:00:00Z`).getTime();
  const p = new Date(`${plannedDate}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(p)) return null;
  return Math.round((a - p) / (24 * 60 * 60 * 1000));
}

/**
 * ProjectGateHealthTable — per-project CCM/CG/PG slip + deferred table.
 * Extracted from RetrospectivePage to keep that file under the
 * minimal-architecture size limit. Behaviour is unchanged.
 */
export function ProjectGateHealthTable({
  loadingProjects,
  projectsPage,
  bootstrap,
  selectedProjectKey,
  selectProject,
  jiraBaseUrl,
}) {
  return (
    <SectionPanel
      title="Projects — Gate Health"
      subtitle="CC = Tasks+UnitTests · CG = P0/P1 Bugs+Improvements · PG = All Bugs+Improvements+Tests"
    >
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
                <th title="Deferred: Items moved out of this release (marked with deferred label)">Deferred</th>
              </tr>
            </thead>
            <tbody>
              {(projectsPage?.projects || []).map((p) => {
                const gd = bootstrap?.gateDates || {};

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

                const ccmSlip = computeSlip(p.ccm?.lastClosedDate, gd.ccmDate);
                const ccmSlipTooltip = ccmSlip == null
                  ? 'No Task/Unit Test closed date available'
                  : ccmSlip > 0
                  ? `⚠ Last Task/Unit Test closed ${p.ccm?.lastClosedDate} — ${ccmSlip} day${ccmSlip !== 1 ? 's' : ''} after the CCM gate (planned ${gd.ccmDate}). ${p.ccm?.openEra || 0} ERA and ${p.ccm?.openNonEra || 0} other tickets still open.`
                  : ccmSlip < 0
                  ? `✓ Last Task/Unit Test closed ${p.ccm?.lastClosedDate} — ${Math.abs(ccmSlip)} day${Math.abs(ccmSlip) !== 1 ? 's' : ''} before the CCM gate (planned ${gd.ccmDate}). Coding done on time.`
                  : `Last Task/Unit Test closed exactly on the CCM gate date (${gd.ccmDate}).`;
                const ccmSlipJql = ccmSlip != null && gd.ccmDate && p.links?.ccmOpen
                  ? `(issueFunction in portfolioChildrenOf("key = ${p.key}") OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = ${p.key}')")) AND issueType in (Task, "Unit Test") AND status was not in (Resolved, Closed, Done) ON "${gd.ccmDate}"`
                  : null;
                const ccmCell = buildGateCell(ccmSlip, p.ccm?.openEra || 0, p.ccm?.openNonEra || 0, ccmSlipJql, ccmSlipTooltip);

                const cgSlip = computeSlip(p.cg?.lastResolvedDate, gd.cgDate);
                const cgSlipTooltip = cgSlip == null
                  ? p.cg?.done === 0 ? 'No P0/P1 bugs found for this project' : 'No P0/P1 bug resolution date available'
                  : cgSlip > 0
                  ? `⚠ Last P0/P1 bug resolved ${p.cg?.lastResolvedDate} — ${cgSlip} day${cgSlip !== 1 ? 's' : ''} after the CG gate (planned ${gd.cgDate}). ${p.cg?.openEra || 0} ERA and ${p.cg?.openNonEra || 0} other P0/P1 bugs still open.`
                  : cgSlip < 0
                  ? `✓ Last P0/P1 bug resolved ${p.cg?.lastResolvedDate} — ${Math.abs(cgSlip)} day${Math.abs(cgSlip) !== 1 ? 's' : ''} before the CG gate (planned ${gd.cgDate}). All critical bugs resolved on time.`
                  : `Last P0/P1 bug resolved exactly on the CG gate date (${gd.cgDate}).`;
                const cgSlipJql = cgSlip != null && gd.cgDate && p.links?.cgOpen
                  ? `(issueFunction in portfolioChildrenOf("key = ${p.key}") OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = ${p.key}')")) AND issueType in (Bug, Improvement) AND priority in ("Blocker - P0", "Critical - P1") AND status was not in (Resolved, Closed, Done) ON "${gd.cgDate}"`
                  : null;
                const cgCell = buildGateCell(cgSlip, p.cg?.openEra || 0, p.cg?.openNonEra || 0, cgSlipJql, cgSlipTooltip);

                const pgSlip = computeSlip(p.pg?.lastResolvedDate, gd.pgDate);
                const pgSlipTooltip = pgSlip == null
                  ? p.pg?.done === 0 ? 'No bugs or tests found for this project' : 'No bug/test resolution date available'
                  : pgSlip > 0
                  ? `⚠ Last bug/test resolved ${p.pg?.lastResolvedDate} — ${pgSlip} day${pgSlip !== 1 ? 's' : ''} after the PG gate (planned ${gd.pgDate}). ${p.pg?.openEra || 0} ERA and ${p.pg?.openNonEra || 0} other bugs/tests still open.`
                  : pgSlip < 0
                  ? `✓ Last bug/test resolved ${p.pg?.lastResolvedDate} — ${Math.abs(pgSlip)} day${Math.abs(pgSlip) !== 1 ? 's' : ''} before the PG gate (planned ${gd.pgDate}). All quality work resolved on time.`
                  : `Last bug/test resolved exactly on the PG gate date (${gd.pgDate}).`;
                const pgSlipJql = pgSlip != null && gd.pgDate && p.links?.pgOpen
                  ? `(issueFunction in portfolioChildrenOf("key = ${p.key}") OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = ${p.key}')")) AND issueType in (Bug, Improvement, Test) AND status was not in (Resolved, Closed, Done) ON "${gd.pgDate}"`
                  : null;
                const pgCell = buildGateCell(pgSlip, p.pg?.openEra || 0, p.pg?.openNonEra || 0, pgSlipJql, pgSlipTooltip);

                const totalDeferred = (p.deferred?.era || 0) + (p.deferred?.nonEra || 0);
                const targetVersionsStr = p.deferred?.targetVersions && p.deferred.targetVersions.length > 0
                  ? ` (to ${p.deferred.targetVersions.join(', ')})`
                  : '';
                const deferredLabel = totalDeferred > 0
                  ? `${totalDeferred} Deferred${targetVersionsStr}`
                  : '—';

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
                    <td style={{ color: ccmCell.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: ccmCell.isDelayed ? 'pointer' : 'default' }} title={ccmCell.tooltip}>
                      {ccmCell.jql ? (
                        <a
                          href={jiraSearchUrl(jiraBaseUrl, ccmCell.jql)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                          title={ccmCell.tooltip}
                        >
                          {ccmCell.label}
                        </a>
                      ) : (
                        ccmCell.label
                      )}
                    </td>
                    <td style={{ color: cgCell.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: cgCell.isDelayed ? 'pointer' : 'default' }} title={cgCell.tooltip}>
                      {cgCell.jql ? (
                        <a
                          href={jiraSearchUrl(jiraBaseUrl, cgCell.jql)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                          title={cgCell.tooltip}
                        >
                          {cgCell.label}
                        </a>
                      ) : (
                        cgCell.label
                      )}
                    </td>
                    <td style={{ color: pgCell.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: pgCell.isDelayed ? 'pointer' : 'default' }} title={pgCell.tooltip}>
                      {pgCell.jql ? (
                        <a
                          href={jiraSearchUrl(jiraBaseUrl, pgCell.jql)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                          title={pgCell.tooltip}
                        >
                          {pgCell.label}
                        </a>
                      ) : (
                        pgCell.label
                      )}
                    </td>
                    <td style={{ color: p.deferred?.era > 0 || p.deferred?.nonEra > 0 ? 'var(--ds-warning)' : 'var(--ds-muted)', textAlign: 'center', fontSize: '0.9em' }}>
                      {p.deferred?.era > 0 || p.deferred?.nonEra > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 'bold' }}>
                            {p.links?.deferred ? (
                              <a href={jiraSearchUrl(jiraBaseUrl, p.links.deferred)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>
                                {deferredLabel}
                              </a>
                            ) : deferredLabel}
                          </div>
                          <div style={{ fontSize: '0.85em' }}>
                            {p.deferred?.era > 0 ? (
                              p.links?.deferredEra ? (
                                <a href={jiraSearchUrl(jiraBaseUrl, p.links.deferredEra)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ds-danger)', textDecoration: 'none' }}>
                                  {p.deferred.era} ERA
                                </a>
                              ) : (
                                <span style={{ color: 'var(--ds-danger)' }}>{p.deferred.era} ERA</span>
                              )
                            ) : null}
                            {p.deferred?.era > 0 && p.deferred?.nonEra > 0 ? ', ' : null}
                            {p.deferred?.nonEra > 0 ? (
                              p.links?.deferredNonEra ? (
                                <a href={jiraSearchUrl(jiraBaseUrl, p.links.deferredNonEra)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ds-warning)', textDecoration: 'none' }}>
                                  {p.deferred.nonEra} other
                                </a>
                              ) : (
                                <span style={{ color: 'var(--ds-warning)' }}>{p.deferred.nonEra} other</span>
                              )
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
              {!projectsPage?.projects?.length ? (
                <tr>
                  <td colSpan={7}>No projects found for this release.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </SectionPanel>
  );
}
