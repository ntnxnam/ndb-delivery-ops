import React, { useCallback, useState } from 'react';
import { PageLoading } from '../../shared/components/PageLoading';
import { useOncallsV2, TIMEFRAMES } from '../../hooks/useOncallsV2';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import { Hero, jiraHref, ticketHref, linkify } from '../Oncalls/OncallsParts';
import KpiPulseBand from '../KpiPulse/KpiPulseBand';
import PathDrill from '../Oncalls/PathDrill';
import './OncallsV2.css';

function PillBar({ timeframe, setTimeframe }) {
  return (
    <div className="ocv2-pills" role="tablist" aria-label="Timeframe">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          aria-selected={timeframe === tf}
          className={`ocv2-pill ${timeframe === tf ? 'active' : ''}`}
          onClick={() => setTimeframe(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

function ExplainHero({ label, cell, explain, jiraBase, onOpen, meta }) {
  const count = cell?.count ?? 0;
  const jiraUrl = jiraHref(jiraBase, cell?.jql);
  const showJiraHint = Boolean(jiraUrl && onOpen);
  const tone = String(label || '').toLowerCase().includes('mttr') || String(label).toLowerCase().includes('throughput') || String(label).toLowerCase().includes('aged share') ? 'neutral' : '';
  return (
    <div className={`ocv2-hero ${tone ? 'ocv2-hero-neutral' : ''}`} title={jiraUrl ? `Open in JIRA` : undefined}>
      <div className="label">{label}</div>
      {onOpen ? (
        <button type="button" className="value oc-hero-open" onClick={onOpen} aria-label={`Show ${label}: ${count}`}>
          {count}
        </button>
      ) : (
        <div className="value">{count}</div>
      )}
      {meta ? <div className="meta">{meta}</div> : null}
      {explain ? <div className="explain">{explain}</div> : null}
      {showJiraHint ? (
        <a className="jira-link" href={jiraUrl} target="_blank" rel="noopener noreferrer">
          Open in JIRA ↗
        </a>
      ) : jiraUrl && !onOpen ? (
        <a className="jira-link" href={jiraUrl} target="_blank" rel="noopener noreferrer">
          Open in JIRA ↗
        </a>
      ) : null}
    </div>
  );
}

function deriveKeysForView(mode, dash, agedDays) {
  if (!dash || !mode) return [];
  const openTickets = dash.openTickets || [];
  const closedPreview = dash.closedStacksPreview || [];
  const gapMeta = dash.gapMeta || {};
  // Closed taxonomy modes use gapMeta or closed preview
  const closedModes = ['duds', 'ndbGaps', 'otherTeamGaps', 'thLinked', 'bugs', 'improvements', 'other', 'closedInWindow'];
  if (closedModes.includes(mode)) {
    if (mode === 'closedInWindow') return closedPreview.slice(0, 12).map((t) => t.key).filter(Boolean);
    if (gapMeta.dudsKeys && mode === 'duds') return (gapMeta.dudsKeys || []).slice(0, 12);
    if (gapMeta.ndbGapsKeys && mode === 'ndbGaps') return (gapMeta.ndbGapsKeys || []).slice(0, 12);
    if (gapMeta.otherTeamGapsKeys && mode === 'otherTeamGaps') return (gapMeta.otherTeamGapsKeys || []).slice(0, 12);
    if (gapMeta.ndbSubKeys && gapMeta.ndbSubKeys[mode]) return (gapMeta.ndbSubKeys[mode] || []).slice(0, 12);
    return closedPreview.slice(0, 12).map((t) => t.key).filter(Boolean);
  }
  if (mode === 'agedOpen') return openTickets.filter((t) => (t.ageDays ?? 0) >= (agedDays ?? 14)).slice(0, 12).map((t) => t.key);
  if (mode === 'needInfo' || mode === 'waiting') {
    const target = mode === 'needInfo' ? 'need info' : 'waiting for customer';
    return openTickets.filter((t) => String(t.status || '').toLowerCase() === target).slice(0, 12).map((t) => t.key);
  }
  if (mode === 'throughput') return openTickets.slice(0, 12).map((t) => t.key);
  return openTickets.slice(0, 12).map((t) => t.key);
}

export default function OncallsV2Page() {
  const { selectedTeamId, hasTeamSelected } = useTeam();
  const {
    timeframe, setTimeframe, data, loading, refreshing, error, refresh,
    aiConcern, aiConcernState, aiConcernError, generateConcern,
    aiSlice, aiSliceState, aiSliceError, aiSliceView, generateSlice, resetAiSlice,
  } = useOncallsV2(selectedTeamId, '7d');

  const [drill, setDrill] = useState(null); // { mode, scope }
  const [showNdbSub, setShowNdbSub] = useState(false);
  const closeDrill = useCallback(() => {
    setDrill(null);
    resetAiSlice();
  }, [resetAiSlice]);
  const openDrill = useCallback((mode, scope = 'open') => {
    setDrill({ mode, scope });
    if (mode && data) {
      const keys = deriveKeysForView(mode, data, data.agedOpenDays ?? 14);
      const meta = {
        count: data.hero?.[mode]?.count ?? data.workflow?.[mode]?.count ?? data.gapTaxonomy?.[mode]?.count ?? data.gapTaxonomy?.ndbSub?.[mode]?.count ?? keys.length,
        agedDays: data.agedOpenDays ?? 14,
        throughput: data.health?.throughput ?? null,
        mttrMedian: data.health?.mttrMedian ?? null,
      };
      generateSlice(mode, keys, meta);
    }
  }, [data, generateSlice]);

  const jiraBase = data?.jiraBaseUrl || '';
  const agedDays = data?.agedOpenDays ?? 14;

  const rag = data?.rag || null;

  const health = data?.health || {};
  const hero = data?.hero || {};

  const taxonomy = data?.gapTaxonomy || {};
  const ndbSub = taxonomy.ndbSub || {};

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Select a team for OnCalls V2"
        description="OnCalls V2 follows the selected team and global timeframe. Pick a team in the sidebar."
      />
    );
  }

  return (
    <div className="ocv2-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1>OnCalls V2</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data?.asOf && <span className="oc-chip">as of {new Date(data.asOf).toLocaleString()}</span>}
          <button type="button" className="oc-btn" onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? 'Pulling…' : 'Pull from JIRA'}
          </button>
          <button type="button" className="oc-btn oc-btn-primary" onClick={generateConcern} disabled={aiConcernState === 'loading' || loading}>
            {aiConcernState === 'loading' ? 'Generating…' : 'Regenerate AI Concern'}
          </button>
        </div>
      </div>

      <PillBar timeframe={timeframe} setTimeframe={setTimeframe} />

      {error && <p className="oc-error">{error}</p>}
      {loading && !data && <PageLoading message="Loading OnCalls V2…" />}

      {data && (
        <>
          {rag && (
            <div className={`oc-rag ${rag.level}`} title={rag.why}>
              {rag.level} — {rag.why}
            </div>
          )}

          {/* audience: team-exec — story first, then drill-down */}
          <div className="ocv2-ai-card">
            <h3 style={{ margin: '0 0 8px' }}>AI Concern — {timeframe}</h3>
            {aiConcernState === 'idle' && <p className="oc-muted">Concern generates after metrics load.</p>}
            {aiConcernState === 'loading' && <p className="oc-muted">Fusing quant+hotspot…</p>}
            {aiConcernState === 'error' && <p className="oc-error">{aiConcernError}</p>}
            {aiConcernState === 'done' && aiConcern && <div>{linkify(aiConcern, jiraBase)}</div>}
          </div>

          {/* Hero row 5 — supporting evidence under story */}
          <div className="ocv2-heroes">
            <ExplainHero label="Open now" cell={hero.open} meta="current stock" explain="All open OnCall tickets in scope" jiraBase={jiraBase} onOpen={() => openDrill('open', 'open')} />
            <ExplainHero label={`Aged >${agedDays}d`} cell={hero.agedOpen} meta={`${agedDays}d threshold from config`} explain="Open longer than aged threshold — needs owner chase" jiraBase={jiraBase} onOpen={() => openDrill('agedOpen', 'open')} />
            <ExplainHero label="Need Info" cell={hero.needInfoOpen} meta={`status = Need Info`} explain="Stuck waiting for reporter details" jiraBase={jiraBase} onOpen={() => openDrill('needInfo', 'open')} />
            <ExplainHero label="Waiting for Customer" cell={hero.waitingCustomerOpen} meta="status = Waiting for Customer" explain="Customer action pending — close loop" jiraBase={jiraBase} onOpen={() => openDrill('waiting', 'open')} />
            <ExplainHero label="Closed in window" cell={hero.closedInWindow} meta={`window: ${timeframe}`} explain="Resolved in selected timeframe (Overall = all closed)" jiraBase={jiraBase} onOpen={() => openDrill('closedInWindow', 'open')} />
          </div>

          {/* Health row 4 — metric-click-dual-action: count → in-app drill, Open in JIRA ↗ → exact JQL */}
          <div className="ocv2-health-row">
            <ExplainHero label="MTTR median" cell={{ count: health.mttrMedian ?? '—', jql: data.pulse?.mttr?.jql || data.pulse?.heroes?.resolvedWindow?.jql }} meta="created → resolved" explain="Typical time to clear" jiraBase={jiraBase} onOpen={() => openDrill('mttr', 'past')} />
            <ExplainHero label="MTTR p90" cell={{ count: health.p90 ?? '—', jql: data.pulse?.mttr?.jql || data.pulse?.heroes?.resolvedWindow?.jql }} meta="slow tail" explain="90th percentile wait" jiraBase={jiraBase} onOpen={() => openDrill('mttr', 'past')} />
            <ExplainHero label="Throughput" cell={{ count: health.throughput ?? 0, jql: data.pulse?.heroes?.resolvedWindow?.jql || data.pulse?.mttr?.jql }} meta={`net ${health.net ?? 0}`} explain="Resolved in window" jiraBase={jiraBase} onOpen={() => openDrill('throughput', 'past')} />
            <ExplainHero label="Aged share" cell={{ count: `${health.agedShare ?? 0}%`, jql: hero.agedOpen?.jql }} meta={`${hero.agedOpen?.count ?? 0} of ${hero.open?.count ?? 0} open`} explain="Aged / open ratio" jiraBase={jiraBase} onOpen={() => openDrill('agedOpen', 'open')} />
          </div>

          {/* How long open table */}
          <div className="ocv2-table-wrap">
            <table className="ocv2-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Count</th>
                  <th>Median age</th>
                  <th>Oldest</th>
                  <th>JQL proof</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Open now</td>
                  <td>{hero.open?.count ?? 0}</td>
                  <td>{health.mttrMedian ?? '—'}d</td>
                  <td>{(data.openTickets || [])[0]?.key || '—'}</td>
                  <td>{hero.open?.jql ? <a href={jiraHref(jiraBase, hero.open.jql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : '—'}</td>
                </tr>
                <tr>
                  <td>Need Info</td>
                  <td>{data.workflow?.needInfo?.count ?? 0}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{data.workflow?.needInfo?.jql ? <a href={jiraHref(jiraBase, data.workflow.needInfo.jql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : '—'}</td>
                </tr>
                <tr>
                  <td>Waiting for Customer</td>
                  <td>{data.workflow?.waiting?.count ?? 0}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{data.workflow?.waiting?.jql ? <a href={jiraHref(jiraBase, data.workflow.waiting.jql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Created vs Resolved graph reuse KpiPulseBand */}
          <KpiPulseBand pulse={data.pulse} jiraBaseUrl={jiraBase} title={`OnCalls pulse · ${timeframe}`} domainHint="OnCalls" loading={loading && !data.pulse} error={data.errors?.pulse || null} />

          {/* Taxonomy 3 cards — count → gap drawer (past scope), Jira link → exact JQL */}
          <div className="ocv2-taxonomy">
            <ExplainHero label="Duds" cell={taxonomy.duds} explain="Duplicate / Won't Do / Cannot Reproduce / no linked fix" jiraBase={jiraBase} meta="resolution gaps" onOpen={() => openDrill('duds', 'past')} />
            <div onDoubleClick={() => setShowNdbSub((v) => !v)} title="Double-click to expand NDB breakdown" style={{ cursor: 'pointer' }}>
              <ExplainHero label="NDB gaps" cell={taxonomy.ndbGaps} explain="Linked fix in NDB project family — double-click to expand" jiraBase={jiraBase} meta="our gaps" onOpen={() => openDrill('ndbGaps', 'past')} />
            </div>
            <ExplainHero label="Other-team gaps" cell={taxonomy.otherTeamGaps} explain="Linked fix outside NDB" jiraBase={jiraBase} meta="externalize" onOpen={() => openDrill('otherTeamGaps', 'past')} />
          </div>

          {/* NDB drill 4 sub-cards — hidden until double-click */}
          {showNdbSub && (
            <>
              <h3>NDB sub-drill (inherits {timeframe})</h3>
              <div className="ocv2-ndb-drill">
                <ExplainHero label="TH linked" cell={ndbSub.thLinked} explain="NDB gaps with TechHelp" jiraBase={jiraBase} onOpen={() => openDrill('thLinked', 'past')} />
                <ExplainHero label="Bugs" cell={ndbSub.bugs} explain="Linked bug type" jiraBase={jiraBase} onOpen={() => openDrill('bugs', 'past')} />
                <ExplainHero label="Improvements" cell={ndbSub.improvements} explain="Linked improvement/story" jiraBase={jiraBase} onOpen={() => openDrill('improvements', 'past')} />
                <ExplainHero label="Other" cell={ndbSub.other} explain="Remaining NDB gaps" jiraBase={jiraBase} onOpen={() => openDrill('other', 'past')} />
              </div>
            </>
          )}

          <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)', padding: '4px 0' }}>
            <PillBar timeframe={timeframe} setTimeframe={setTimeframe} />
          </div>
          <PathDrill
            mode={drill?.mode}
            tickets={['duds','ndbGaps','otherTeamGaps','thLinked','bugs','improvements','other','closedInWindow','throughput','mttr'].includes(drill?.mode) ? (data.closedStacksPreview || []) : data.openTickets}
            jiraBase={jiraBase}
            jql={drill ? (data.workflow?.[drill.mode]?.jql || data.gapTaxonomy?.[drill.mode]?.jql || data.gapTaxonomy?.ndbSub?.[drill.mode]?.jql || data.hero?.[drill.mode]?.jql || data.pulse?.mttr?.jql || data.pulse?.heroes?.resolvedWindow?.jql || null) : null}
            cellCount={drill ? (data.workflow?.[drill.mode]?.count ?? data.gapTaxonomy?.[drill.mode]?.count ?? data.gapTaxonomy?.ndbSub?.[drill.mode]?.count ?? data.hero?.[drill.mode]?.count ?? data.health?.throughput ?? data.pulse?.heroes?.resolvedWindow?.count ?? null) : null}
            scope={['duds','ndbGaps','otherTeamGaps','thLinked','bugs','improvements','other','closedInWindow','throughput','mttr'].includes(drill?.mode) ? 'past' : (drill?.scope || 'open')}
            gapLabel="yet"
            agedDays={agedDays}
            teamId={selectedTeamId}
            seedStacks={data.stacksPreview}
            gapMeta={data.gapMeta}
            timeframe={timeframe}
            aiSlice={aiSlice}
            aiSliceState={aiSliceState}
            aiSliceError={aiSliceError}
            aiSliceView={aiSliceView}
            onClose={closeDrill}
          />
        </>
      )}
    </div>
  );
}
