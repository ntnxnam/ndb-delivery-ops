import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageLoading } from '../shared/components/PageLoading';
import { useOncalls } from '../hooks/useOncalls';
import { useTeam } from '../contexts/TeamContext';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import { usePermissions } from '../auth/hooks/usePermissions';
import { useExecPageBriefing } from '../hooks/useExecPageBriefing';
import ExecPageBriefing from './ExecPageBriefing';
import {
  JIRA_BASE,
  Hero,
  PathHeroes,
  PortfolioOutcomes,
  TicketsTable,
  SummaryBody,
  ticketHref,
  linkify,
} from './Oncalls/OncallsParts';

import EscalationDrill from './Oncalls/EscalationDrill';
import PathDrill from './Oncalls/PathDrill';
import KpiPulseBand from './KpiPulse/KpiPulseBand';
import './Oncalls/Oncalls.css';

const PULSE_TO_PATH_MODE = {
  openNow: 'open',
  agedOpen: 'agedOpen',
  p0Open: 'p0Open',
  p1Open: 'p1Open',
};

export default function OncallsPage() {
  const { selectedTeamId, hasTeamSelected } = useTeam();
  const { isExecAudience } = usePermissions();
  const {
    data,
    loading,
    refreshing,
    error,
    refresh,
    aiState,
    aiSummary,
    aiIntelligence,
    aiError,
    generateBriefing,
  } = useOncalls(selectedTeamId, { skipAutoBriefing: isExecAudience });
  const {
    state: execBriefState,
    summary: execBriefSummary,
    meta: execBriefMeta,
    error: execBriefError,
    refresh: refreshExecBrief,
  } = useExecPageBriefing({
    enabled: isExecAudience,
    surface: 'oncall',
    teamId: selectedTeamId,
    snapshot: data,
    snapshotKey: data?.asOf || '',
    ready: Boolean(data?.asOf),
  });
  const [escDrill, setEscDrill] = useState(null);
  const [pathDrill, setPathDrill] = useState(null); // { mode, scope: 'open'|'past' }
  const closeEscDrill = useCallback(() => setEscDrill(null), []);
  const closePathDrill = useCallback(() => setPathDrill(null), []);
  const openEscDrill = useCallback((mode) => {
    setPathDrill(null);
    setEscDrill(mode);
  }, []);
  const openPathDrill = useCallback((mode, scope) => {
    setEscDrill(null);
    setPathDrill({ mode, scope });
  }, []);
  const openPulseHero = useCallback(
    (heroKey) => {
      const mode = PULSE_TO_PATH_MODE[heroKey];
      if (!mode) return;
      openPathDrill(mode, 'open');
    },
    [openPathDrill]
  );

  useEffect(() => {
    setEscDrill(null);
    setPathDrill(null);
  }, [selectedTeamId]);

  const jiraBase = data?.jiraBaseUrl || JIRA_BASE;
  const agedDays = data?.agedOpenDays ?? 14;
  const pastDays = data?.pastLookbackDays ?? data?.past?.lookbackDays ?? 30;
  const story = useMemo(() => {
    if (!data?.rag) return 'Pull OnCall metrics to see who is waiting and what to chase.';
    const open = data.hero?.open?.count ?? 0;
    const missing = data.paths?.withoutRemediation?.count ?? 0;
    const esc = data.escalation?.summary;
    const escBit =
      esc && data.escalation?.enabled !== false
        ? ` ${esc.withEscalationLink || 0} reached CFD/CFI-class KPIs` +
          (esc.medianDaysToResolve != null ? ` (median ${esc.medianDaysToResolve}d to clear)` : '') +
          (esc.openEscalations ? `; ${esc.openEscalations} still open there` : '') +
          '.'
        : '';
    return `${data.rag.level}: ${open} open customer OnCall(s); ${missing} with no workaround or eng fix.${escBit}`;
  }, [data]);

  const escLead = useMemo(() => {
    const esc = data?.escalation;
    if (!esc || esc.enabled === false) return null;
    const s = esc.summary || {};
    const kpiNames = (esc.kpis || []).map((k) => k.name).join(', ') || 'CFD/CFI';
    const n = s.withEscalationLink ?? 0;
    const openN = s.openEscalations ?? 0;
    const med = s.medianDaysToResolve;
    const p90 = s.p90DaysToResolve;
    if (!n) return `No OnCalls in this window linked into ${kpiNames}.`;
    return `${n} OnCall(s) reached field KPIs (${kpiNames}). ${openN} still waiting. ` +
      `Top CFD is costliest — click the count for KPI badge + linked OnCall pairs.` +
      (med != null ? ` Among cleared: median ${med}d (p90 ${p90 ?? '—'}d).` : '');
  }, [data]);

  const portfolioLead = useMemo(() => {
    const paths = data?.paths;
    if (!paths) return null;
    const chase = paths.withoutRemediation?.count ?? 0;
    const needEng = paths.withoutEng?.count ?? 0;
    const inFlight = paths.withEng?.count ?? 0;
    if (chase > 0) {
      return `${chase} open OnCall(s) have no TechHelp or eng/docs path — chase those first. ${inFlight} already have a fix linked.`;
    }
    if (needEng > 0) {
      return `No fully uncovered OnCalls. ${needEng} have TechHelp but still need an eng/docs owner. ${inFlight} already linked to a fix.`;
    }
    return `Remediation paths look covered for open OnCalls (${inFlight} with eng/docs linked). Use the footprint link only if you need the full linked graph.`;
  }, [data]);

  const whoLead = useMemo(() => {
    const top = (data?.assigneeMix || [])[0];
    const open = data?.hero?.open?.count ?? 0;
    if (!top || !open) return 'Who is holding open OnCalls right now.';
    return `${top.name} holds the most open OnCalls (${top.count} of ${open}).`;
  }, [data]);

  const stacks = aiIntelligence?.stacks || data?.stacksPreview || [];

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Select a team for OnCalls"
        description="OnCall metrics follow the selected team. Pick a team in the sidebar, then click Fetch."
      />
    );
  }

  return (
    <div className="oc-page">
      <div className="oc-header">
        <div>
          <h1>OnCalls</h1>
          <p className="oc-story">{story}</p>
          <p className="oc-muted">
            Stack: customer OnCall → TechHelp (workaround) → eng fix (linked ticket in any eng project).
          </p>
        </div>
        <div className="oc-actions">
          {data?.asOf && (
            <span className="oc-chip">as of {new Date(data.asOf).toLocaleString()}</span>
          )}
          <button type="button" className="oc-btn" onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? 'Pulling…' : 'Pull from JIRA'}
          </button>
          <button
            type="button"
            className="oc-btn oc-btn-primary"
            onClick={generateBriefing}
            disabled={aiState === 'loading' || loading}
          >
            {aiState === 'loading'
              ? 'Generating…'
              : aiState === 'done' || aiState === 'error'
                ? 'Regenerate AI Briefing'
                : 'Generate AI Briefing'}
          </button>
        </div>
      </div>

      {error && <p className="oc-error">{error}</p>}
      {loading && !data && <PageLoading message="Loading OnCall metrics…" />}

      <ExecPageBriefing
        state={execBriefState}
        summary={execBriefSummary}
        meta={execBriefMeta}
        error={execBriefError}
        onRetry={refreshExecBrief}
        jiraBase={jiraBase}
      />

      {data && (
        <>
          <div className="oc-section">
            {data.rag && (
              <div className={`oc-rag ${data.rag.level}`} title={data.rag.why}>
                {data.rag.level} — {data.rag.why}
              </div>
            )}
            <KpiPulseBand
              pulse={data.pulse}
              jiraBaseUrl={jiraBase}
              title="OnCalls · last 2 Nutanix Qs"
              domainHint="OnCalls"
              loading={loading && !data.pulse}
              error={data.errors?.pulse || (!data.pulse && !loading ? 'Pulse unavailable' : null)}
              onHeroClick={openPulseHero}
            />
          </div>

          <div className="oc-section">
            <h2>Current — path coverage</h2>
            <p className="oc-muted">
              Open OnCalls that already have TechHelp / eng / docs linked.
            </p>
            {data.paths?.sample?.capped && (
              <p className="oc-muted">
                From {data.paths.sample.openFetched} of {data.paths.sample.openTotal} open OnCalls
                (Pulse Open is the full count).
              </p>
            )}
            <PathHeroes
              paths={data.paths}
              jiraBase={jiraBase}
              onOpen={(mode) => openPathDrill(mode, 'open')}
            />
          </div>

          <div className="oc-section">
            <h2>Portfolio outcomes — what to chase</h2>
            {portfolioLead && <p className="oc-story oc-story-tight">{portfolioLead}</p>}
            <p className="oc-muted">
              Gaps first, then in-flight fixes. Click a count for the OnCall list; linked footprint stays proof-only.
            </p>
            <PortfolioOutcomes
              paths={data.paths}
              jiraBase={jiraBase}
              onOpen={(mode) => openPathDrill(mode, 'open')}
            />
          </div>

          <div className="oc-section">
            <h2>Current — who is getting hit</h2>
            <p className="oc-story oc-story-tight">{whoLead}</p>
            <div className="oc-mix">
              {(data.assigneeMix || []).map((a) => (
                <span key={a.name} className="oc-chip">
                  {a.name}: {a.count}
                </span>
              ))}
              {!(data.assigneeMix || []).length && <span className="oc-muted">No open assignees</span>}
            </div>
            <div className="oc-mix oc-mix-second">
              {(data.priorityMix || []).map((a) => (
                <span key={a.name} className="oc-chip">
                  {a.name}: {a.count}
                </span>
              ))}
            </div>
          </div>

          <div className="oc-section">
            <details className="oc-drill">
              <summary>
                Open OnCall tickets ({(data.openTickets || []).length})
              </summary>
              <TicketsTable rows={data.openTickets} jiraBase={jiraBase} mode="open" />
            </details>
          </div>

          <div className="oc-section">
            <h2>Past — closed OnCalls (last {pastDays}d)</h2>
            <p className="oc-muted">
              What closed recently and whether TechHelp / eng / docs were linked.
            </p>
            <div className="oc-heroes">
              <Hero
                label="Closed in window"
                cell={data.past?.closed}
                sub={`last ${pastDays} days`}
                jiraBase={jiraBase}
              />
            </div>
            {data.past?.paths?.sample?.capped && (
              <p className="oc-muted">
                From {data.past.paths.sample.fetched} of {data.past.paths.sample.closedTotal} closed
                OnCalls (Closed in window is the full count).
              </p>
            )}
            <PathHeroes
              paths={data.past?.paths}
              jiraBase={jiraBase}
              onOpen={(mode) => openPathDrill(mode, 'past')}
            />
            <details className="oc-drill" style={{ marginTop: '0.75rem' }}>
              <summary>
                Closed ticket list ({(data.past?.tickets || []).length})
              </summary>
              <TicketsTable rows={data.past?.tickets} jiraBase={jiraBase} mode="past" />
            </details>
          </div>

          {data.escalation && (
            <div className="oc-section">
              <h2>
                Escalated to{' '}
                {(data.escalation.kpis || []).map((k) => k.name).join(' · ') || 'CFD / CFI'}
                {data.escalation.lookbackDays
                  ? ` (last ${data.escalation.lookbackDays}d + open)`
                  : ''}
              </h2>
              {escLead && <p className="oc-story oc-story-tight">{escLead}</p>}
              <p className="oc-muted">
                OnCalls that link into these team KPIs
                {(data.escalation.kpis || []).length
                  ? ` (${(data.escalation.kpis || []).map((k) => k.name).join(', ')})`
                  : ''}
                . Clock: OnCall created → linked field ticket cleared.
                {data.escalation.enabled === false && data.escalation.reason
                  ? ` ${data.escalation.reason}`
                  : ''}
              </p>
              {(data.escalation.warnings || []).length > 0 && (
                <p className="oc-error">
                  Some KPI filters failed to resolve: {data.escalation.warnings.join('; ')}
                </p>
              )}
              {data.escalation.enabled !== false && (
                <>
                  <div className="oc-heroes">
                    <Hero
                      label="Reached KPI"
                      cell={data.escalation.cells?.withEscalation}
                      sub="field escalations · click for KPI badge + OnCall pairs"
                      jiraBase={jiraBase}
                      title="Opens each CFD/CFI ticket with its KPI badge and the OnCall that linked it (costliest first)"
                      onOpen={() => openEscDrill('withEscalation')}
                    />
                    <Hero
                      label="KPI cleared"
                      cell={data.escalation.cells?.resolved}
                      sub={
                        (data.escalation.summary?.medianDaysToResolve != null
                          ? `median ${data.escalation.summary.medianDaysToResolve}d · p90 ${data.escalation.summary.p90DaysToResolve ?? '—'}d`
                          : 'none cleared yet') + ' · click for pairs'
                      }
                      jiraBase={jiraBase}
                      title="Opens done CFD/CFI tickets with KPI badge and linked OnCall (shows real JIRA status)"
                      onOpen={() => openEscDrill('resolved')}
                    />
                    <Hero
                      label="KPI still open"
                      cell={data.escalation.cells?.stillOpen}
                      sub="customer wait ongoing · click for pairs"
                      jiraBase={jiraBase}
                      title="Opens open CFD/CFI tickets with KPI badge and the OnCall still waiting"
                      onOpen={() => openEscDrill('stillOpen')}
                    />
                  </div>
                  {(data.escalation.rows || []).length === 0 && (
                    <p className="oc-muted">
                      No OnCalls in window with links into{' '}
                      {(data.escalation.kpis || []).map((k) => k.name).join(', ') || 'CFD/CFI'} KPIs.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <EscalationDrill
            mode={escDrill}
            rows={data.escalation?.rows}
            jiraBase={jiraBase}
            jql={escDrill ? data.escalation?.cells?.[escDrill]?.jql : null}
            cellCount={escDrill ? data.escalation?.cells?.[escDrill]?.count : null}
            kpiNames={(data.escalation?.kpis || []).map((k) => k.name)}
            teamId={selectedTeamId}
            seedStacks={aiIntelligence?.stacks || data?.stacksPreview}
            onClose={closeEscDrill}
          />
          <PathDrill
            mode={pathDrill?.mode}
            tickets={pathDrill?.scope === 'past' ? data.past?.tickets : data.openTickets}
            jiraBase={jiraBase}
            jql={
              pathDrill
                ? (() => {
                    if (pathDrill.scope === 'past') {
                      return data.past?.paths?.[pathDrill.mode]?.jql || null;
                    }
                    const pulseKey = pathDrill.mode === 'open' ? 'openNow' : pathDrill.mode;
                    const pulseCell = data.pulse?.heroes?.[pulseKey];
                    // Pulse open-family modes: prefer pulse JQL (exact count proof).
                    if (pulseCell?.jql && ['open', 'agedOpen', 'p0Open', 'p1Open'].includes(pathDrill.mode)) {
                      return pulseCell.jql;
                    }
                    return (
                      data.paths?.[pathDrill.mode]?.jql ||
                      data.hero?.[pathDrill.mode]?.jql ||
                      null
                    );
                  })()
                : null
            }
            cellCount={
              pathDrill
                ? (() => {
                    if (pathDrill.scope === 'past') {
                      return data.past?.paths?.[pathDrill.mode]?.count ?? null;
                    }
                    const pulseKey = pathDrill.mode === 'open' ? 'openNow' : pathDrill.mode;
                    const pulseCell = data.pulse?.heroes?.[pulseKey];
                    if (
                      pulseCell != null &&
                      ['open', 'agedOpen', 'p0Open', 'p1Open'].includes(pathDrill.mode)
                    ) {
                      return pulseCell.count ?? null;
                    }
                    return (
                      data.paths?.[pathDrill.mode]?.count ??
                      data.hero?.[pathDrill.mode]?.count ??
                      null
                    );
                  })()
                : null
            }
            scope={pathDrill?.scope || 'open'}
            gapLabel={pathDrill?.scope === 'past' ? 'when closed' : 'yet'}
            agedDays={agedDays}
            teamId={selectedTeamId}
            seedStacks={aiIntelligence?.stacks || data?.stacksPreview}
            onClose={closePathDrill}
          />
        </>
      )}

      <div className="oc-section">
        <div className="oc-ai-panel">
          <h2>Chase list / qualitative briefing</h2>
          {aiState === 'idle' && (
            <p className="oc-muted">
              Briefing starts after metrics load — TechHelp themes, eng/TechPubs outcomes, who to chase.
            </p>
          )}
          {aiState === 'loading' && <p className="oc-muted">Building stack narratives…</p>}
          {aiState === 'error' && <p className="oc-error">{aiError}</p>}
          {aiState === 'done' && <SummaryBody summary={aiSummary} jiraBase={jiraBase} />}
        </div>

        {stacks.length > 0 && (
          <div className="oc-stacks">
            <h2 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.4rem' }}>
              OnCall stacks {aiIntelligence ? '(enriched)' : '(preview)'}
            </h2>
            {stacks.map((s) => (
              <details key={s.key} className="oc-stack">
                <summary>
                  <a
                    href={ticketHref(jiraBase, s.key)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.key}
                  </a>
                  {' — '}
                  {s.priority || '?'} · {s.status}
                  {s.dwell?.currentDwellDays != null ? ` · ${s.dwell.currentDwellDays}d dwell` : ''}
                  {s.ageDays != null ? ` · age ${s.ageDays}d` : ''}
                  {' · '}
                  TH {(s.techHelp || s.techHelpKeys || []).length} / eng{' '}
                  {(s.engFixes || s.engFixKeys || []).length}
                </summary>
                <div className="oc-stack-body">
                  <div>{s.summary || s.blurb}</div>
                  {s.blurb && s.summary ? (
                    <div style={{ marginTop: 4 }}>{linkify(s.blurb, jiraBase)}</div>
                  ) : null}
                  {(s.techHelp || []).length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      TechHelp:{' '}
                      {s.techHelp.map((t) => (
                        <span key={t.key}>
                          <a href={ticketHref(jiraBase, t.key)} target="_blank" rel="noopener noreferrer">
                            {t.key}
                          </a>
                          ({t.status}){' '}
                        </span>
                      ))}
                    </div>
                  )}
                  {(s.engFixes || []).length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      Eng:{' '}
                      {s.engFixes.map((t) => (
                        <span key={t.key}>
                          <a href={ticketHref(jiraBase, t.key)} target="_blank" rel="noopener noreferrer">
                            {t.key}
                          </a>
                          ({t.status}){' '}
                        </span>
                      ))}
                    </div>
                  )}
                  {!s.techHelp && (s.techHelpKeys || []).length > 0 && (
                    <div style={{ marginTop: 4 }}>TechHelp: {s.techHelpKeys.join(', ')}</div>
                  )}
                  {!s.engFixes && (s.engFixKeys || []).length > 0 && (
                    <div style={{ marginTop: 4 }}>Eng: {s.engFixKeys.join(', ')}</div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
