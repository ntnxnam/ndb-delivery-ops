import React, { useCallback, useState } from 'react';
import { PageLoading } from '../../shared/components/PageLoading';
import { useOncallsV2, TIMEFRAMES } from '../../hooks/useOncallsV2';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import { Hero, jiraHref, ticketHref, linkify } from '../Oncalls/OncallsParts';
import KpiPulseBand from '../KpiPulse/KpiPulseBand';
import PathDrill from '../Oncalls/PathDrill';
import '../Oncalls/Oncalls.css';
import './OncallsV2.css';
import OncallReportSection from './OncallReportSection';
import { useOncallReport } from '../../hooks/useOncallReport';

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

function heroGlossary(label, agedDays) {
  const l = String(label || '').toLowerCase();
  if (l.includes('open now')) return { what: 'Count of open OnCall tickets in the team scope (statusCategory != Done).', how: 'Click the number → in-app list with age/status; "Open in JIRA ↗" → exact JQL (scope + open clause).', why: 'Live customer load — if this climbs week-over-week, interrupt capacity is squeezed.' };
  if (l.includes('aged')) return { what: `Open tickets older than ${agedDays}d (created <= -${agedDays}d).`, how: `Number is subset of Open now; JQL adds created <= -${agedDays}d. Drill shows oldest first.`, why: 'Stale work breeds SLA breach — chase owner or close loop.' };
  if (l === 'need info') return { what: 'Open OnCalls with status = "Need Info" (waiting for reporter).', how: 'Status-exact JQL, past 0 days filter; drill lists those tickets.', why: 'Reporter info unblocks triage — ping requester or close as incomplete.' };
  if (l.includes('waiting for customer')) return { what: 'Open tickets with status = "Waiting for Customer".', how: 'Status-exact JQL; drill shows waiting set.', why: 'Customer action is the gate — nudge or auto-close per policy.' };
  if (l.includes('closed in window')) return { what: 'Tickets resolved in the selected timeframe (resolved >= -Nd; Overall = all closed, no date clause).', how: 'Count → past-sample drill; JQL proof uses resolved date window.', why: 'Shows throughput capacity and gap taxonomy denominator.' };
  if (l.includes('mttr median')) return { what: 'Median days from created → resolved for closed-in-window sample (p50).', how: 'From pulse.mttr.medianDays; JQL = resolved window; click → throughput drill.', why: 'Green <7d, warn 7-14d, alarm >14d — signals fix speed.' };
  if (l.includes('mttr p90')) return { what: '90th percentile of same created→resolved distribution (tail).', how: 'Same JQL as median; higher than median = long tail.', why: 'Tail reveals rare but painful long escapes.' };
  if (l.includes('throughput')) return { what: 'Count resolved in window (closed-in-window total).', how: 'JQL = resolved window; net = created−resolved shown as meta.', why: 'Matches Closed in window — falling throughput = slower close rate.' };
  if (l.includes('aged share')) return { what: 'Aged / Open ratio as percent.', how: 'Derived: agedCount / openCount ×100; JQL links to aged hero.', why: 'Share >25% means a quarter of backlog is stale.' };
  if (l === 'duds') return { what: 'Closed tickets with dud resolution (Duplicate/Won’t Do/Cannot Reproduce/Invalid) or no linked fix.', how: 'key in (dudKeys) JQL; drill past-sample.', why: 'High duds = triage noise, not real gaps.' };
  if (l === 'ndb gaps') return { what: 'Closed tickets with linked fix in NDB family (project prefix from cfg.gapProjectPrefixes, tenant includes ERA).', how: 'key in (ndbGapsKeys) proof; click to expand NDB sub-drill.', why: 'Our gaps — we own the fix.' };
  if (l.includes('other-team')) return { what: 'Closed tickets with linked fix outside NDB family (other product teams).', how: 'key in (otherTeamGapsKeys); externalize.', why: 'Hand off or track cross-team dependency.' };
  if (l === 'th linked') return { what: 'NDB-gap subset that already had TechHelp (SR/TH) linked.', how: 'NDB sub key set thLinked; proof JQL filtered to TH present.', why: 'Shows workaround coverage before eng fix.' };
  if (l === 'bugs') return { what: 'NDB-gap subset where linked fix issuetype is Bug.', how: 'Filtered by issuetype contains bug.', why: 'Product defects vs enhancements.' };
  if (l === 'improvements') return { what: 'NDB-gap subset where linked fix issuetype is Improvement/Story/Task.', how: 'Filtered by issuetype improvement/story.', why: 'Enhancements vs bugs — capacity planning differs.' };
  if (l === 'other') return { what: 'Remaining NDB gaps not in TH/Bugs/Improvements buckets.', how: 'Leftover key set; inspect for misc types.', why: 'Catch-all — should stay <10% if taxonomy is healthy.' };
  return { what: '', how: '', why: '' };
}
function ExplainHero({ label, cell, explain, jiraBase, onOpen, meta, agedDays }) {
  const count = cell?.count ?? 0;
  const jiraUrl = jiraHref(jiraBase, cell?.jql);
  const showJiraHint = Boolean(jiraUrl && onOpen);
  const tone = String(label || '').toLowerCase().includes('mttr') || String(label).toLowerCase().includes('throughput') || String(label).toLowerCase().includes('aged share') ? 'neutral' : '';
  const g = heroGlossary(label, agedDays);
  const tip = [g.what && `What: ${g.what}`, g.how && `How: ${g.how}`, g.why && `Why: ${g.why}`, meta ? `Meta: ${meta}` : null].filter(Boolean).join('\n');
  return (
    <div className={`ocv2-hero ${tone ? 'ocv2-hero-neutral' : ''}`} title={jiraUrl ? `Open in JIRA` : undefined}>
      <div className="label">{label} <span title={tip} aria-label={`Explain ${label}`} style={{ cursor: 'help', fontWeight: 700, marginLeft: 4 }}>ℹ︎</span></div>
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
  const { busy: reportBusy, error: reportError, preview: previewReport, send: sendReport } = useOncallReport({ teamId: selectedTeamId, timeframe, dashboard: data, aiConcern });
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

      <details style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-4)', background: 'var(--surface)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-small)' }}>What each number means — how to read & why it matters (ℹ︎ on each card)</summary>
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table className="ocv2-table" style={{ minWidth: 720 }}>
            <thead><tr><th style={{ width: 160 }}>Hero</th><th>What it counts</th><th>How to read</th><th>Why it matters</th></tr></thead>
            <tbody>
              {[
                ['Open now', 'Open OnCalls in team scope (statusCategory != Done)', 'Click number → in-app list (age/status); Open in JIRA ↗ → exact JQL', 'Live customer load; rising = capacity squeeze'],
                [`Aged >${agedDays}d`, `Open tickets older than ${agedDays}d (created <= -${agedDays}d)`, 'Subset of Open now; drill oldest first', 'Stale work risks SLA breach — chase owner'],
                ['Need Info', 'Open with status = "Need Info"', 'Status-exact JQL; drill lists that status', 'Reporter info unblocks triage'],
                ['Waiting for Customer', 'Open with status = "Waiting for Customer"', 'Status-exact JQL; drill lists that set', 'Customer gate — nudge or auto-close'],
                ['Closed in window', `Resolved in selected pill (resolved >= -Nd; Overall = all closed, no date clause)`, 'Past-sample drill; JQL uses resolved window', 'Throughput denominator + gap taxonomy scope'],
                ['MTTR median', 'Median created→resolved days for closed-in-window (p50)', 'From pulse.mttr.medianDays; same JQL as throughput', 'Fix speed — <7d green, >14d alarm'],
                ['MTTR p90', '90th percentile of same distribution (tail)', 'Same JQL; higher than median = long tail', 'Rare long escapes show where to harden'],
                ['Throughput', 'Count resolved in window (closed-in-window total)', 'JQL = resolved window; net = created−resolved', 'Matches Closed in window; falling = slower close rate'],
                ['Aged share', 'Aged / Open as percent', 'Derived agedCount/openCount×100; JQL links to aged hero', '>25% means quarter of backlog is stale'],
                ['Duds', 'Closed with dud resolution (Duplicate/Won’t Do/Cannot Reproduce/Invalid) or no linked fix', 'key in (dudKeys) proof', 'High duds = triage noise not real gaps'],
                ['NDB gaps', 'Closed with linked fix in NDB family (gapProjectPrefixes, includes ERA)', 'key in (ndbGapsKeys); expand for sub-breakdown', 'Our gaps — we own fix'],
                ['Other-team gaps', 'Closed with linked fix outside NDB family', 'key in (otherTeamGapsKeys)', 'Cross-team dependency to hand off'],
                ['TH linked', 'NDB-gap subset with TechHelp linked', 'NDB sub thLinked key set', 'Workaround coverage before eng fix'],
                ['Bugs', 'NDB-gap subset issuetype Bug', 'Filtered by issuetype bug', 'Defects vs enhancements'],
                ['Improvements', 'NDB-gap subset issuetype Improvement/Story/Task', 'Filtered by issuetype improvement', 'Enhancements capacity planning'],
                ['Other', 'Remaining NDB gaps', 'Leftover key set', 'Should stay <10% if taxonomy healthy'],
              ].map(([h, w, hr, y]) => (
                <tr key={h}><td style={{ fontWeight: 600 }}>{h}</td><td>{w}</td><td style={{ color: 'var(--muted)' }}>{hr}</td><td>{y}</td></tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 8 }}>Every count → in-app drill (PathDrill) + Open in JIRA ↗ → exact JQL (never both external). All JIRA links open in new tab.</p>
        </div>
      </details>

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
            <h3 style={{ margin: '0 0 8px' }}>AI Concern — {timeframe} <span title="AI generated" aria-label="AI generated" style={{ fontSize: '0.9em', marginLeft: 4 }}>✨</span></h3>
            {aiConcernState === 'idle' && <p className="oc-muted">Concern generates after metrics load.</p>}
            {aiConcernState === 'loading' && <p className="oc-muted">Fusing quant+hotspot…</p>}
            {aiConcernState === 'error' && <p className="oc-error">{aiConcernError}</p>}
            {aiConcernState === 'done' && aiConcern && <div>{linkify(aiConcern, jiraBase)}</div>}
          </div>

          {/* Hero row 5 — supporting evidence under story */}
          <div className="ocv2-heroes">
            <ExplainHero label="Open now" cell={hero.open} meta="current stock" explain="All open OnCall tickets in scope" jiraBase={jiraBase} onOpen={() => openDrill('open', 'open')} agedDays={agedDays} />
            <ExplainHero label={`Aged >${agedDays}d`} cell={hero.agedOpen} meta={`${agedDays}d threshold from config`} explain="Open longer than aged threshold — needs owner chase" jiraBase={jiraBase} onOpen={() => openDrill('agedOpen', 'open')} agedDays={agedDays} />
            <ExplainHero label="Need Info" cell={hero.needInfoOpen} meta={`status = Need Info`} explain="Stuck waiting for reporter details" jiraBase={jiraBase} onOpen={() => openDrill('needInfo', 'open')} agedDays={agedDays} />
            <ExplainHero label="Waiting for Customer" cell={hero.waitingCustomerOpen} meta="status = Waiting for Customer" explain="Customer action pending — close loop" jiraBase={jiraBase} onOpen={() => openDrill('waiting', 'open')} agedDays={agedDays} />
            <ExplainHero label="Closed in window" cell={hero.closedInWindow} meta={`window: ${timeframe}`} explain="Resolved in selected timeframe (Overall = all closed)" jiraBase={jiraBase} onOpen={() => openDrill('closedInWindow', 'open')} agedDays={agedDays} />
          </div>

          {/* Health row 4 — metric-click-dual-action: count → in-app drill, Open in JIRA ↗ → exact JQL */}
          <div className="ocv2-health-row">
            <ExplainHero label="MTTR median" cell={{ count: health.mttrMedian ?? '—', jql: data.pulse?.mttr?.jql || data.pulse?.heroes?.resolvedWindow?.jql }} meta="created → resolved" explain="Typical time to clear" jiraBase={jiraBase} onOpen={() => openDrill('mttr', 'past')} agedDays={agedDays} />
            <ExplainHero label="MTTR p90" cell={{ count: health.p90 ?? '—', jql: data.pulse?.mttr?.jql || data.pulse?.heroes?.resolvedWindow?.jql }} meta="slow tail" explain="90th percentile wait" jiraBase={jiraBase} onOpen={() => openDrill('mttr', 'past')} agedDays={agedDays} />
            <ExplainHero label="Throughput" cell={{ count: health.throughput ?? 0, jql: data.pulse?.heroes?.resolvedWindow?.jql || data.pulse?.mttr?.jql }} meta={`net ${health.net ?? 0}`} explain="Resolved in window" jiraBase={jiraBase} onOpen={() => openDrill('throughput', 'past')} agedDays={agedDays} />
            <ExplainHero label="Aged share" cell={{ count: `${health.agedShare ?? 0}%`, jql: hero.agedOpen?.jql }} meta={`${hero.agedOpen?.count ?? 0} of ${hero.open?.count ?? 0} open`} explain="Aged / open ratio" jiraBase={jiraBase} onOpen={() => openDrill('agedOpen', 'open')} agedDays={agedDays} />
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
          <KpiPulseBand pulse={data.pulse} jiraBaseUrl={jiraBase} title={`OnCalls pulse · ${timeframe}`} domainHint="OnCalls" hideResolved loading={loading && !data.pulse} error={data.errors?.pulse || null} />

          {/* Taxonomy 3 cards — count → gap drawer (past scope), Jira link → exact JQL */}
          <div className="ocv2-taxonomy">
            <ExplainHero label="Duds" cell={taxonomy.duds} explain="Duplicate / Won't Do / Cannot Reproduce / no linked fix" jiraBase={jiraBase} meta="resolution gaps" onOpen={() => openDrill('duds', 'past')} agedDays={agedDays} />
            <button type="button" onClick={() => setShowNdbSub((v) => !v)} aria-expanded={showNdbSub} title="Toggle NDB breakdown" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
              <ExplainHero label="NDB gaps" cell={taxonomy.ndbGaps} explain="Linked fix in NDB project family — click to expand" jiraBase={jiraBase} meta="our gaps" onOpen={() => openDrill('ndbGaps', 'past')} agedDays={agedDays} />
            </button>
            <ExplainHero label="Other-team gaps" cell={taxonomy.otherTeamGaps} explain="Linked fix outside NDB (other product teams)" jiraBase={jiraBase} meta="linked to other teams" onOpen={() => openDrill('otherTeamGaps', 'past')} agedDays={agedDays} />
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

          <OncallReportSection teamId={selectedTeamId} timeframe={timeframe} busy={reportBusy} error={reportError} onPreview={previewReport} onSend={sendReport} />

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
