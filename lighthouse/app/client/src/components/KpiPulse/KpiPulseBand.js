import React from 'react';
import PulseHero from './PulseHero';
import CreatedResolvedChart from './CreatedResolvedChart';
import StatusDwellTiles from './StatusDwellTiles';
import ProductImpactCard from './ProductImpactCard';
import { PULSE_PANEL_HERO_KEYS } from './pulsePanelHeroKeys';
import './KpiPulse.css';

export { PULSE_PANEL_HERO_KEYS } from './pulsePanelHeroKeys';

/**
 * Shared KPI Pulse band — heroes, weekly created/resolved, status dwell, product impact.
 * Data from kpiPulseService.buildPulse; only baseJql differs per page.
 *
 * @param {function} [onHeroClick] — (heroKey, cell) => void. When set, open-family
 *   heroes (see PULSE_PANEL_HERO_KEYS) use in-page open; JIRA remains via PulseHero
 *   hint. Flow heroes (Created / Resolved / MTTR) stay count → JIRA. Derived metrics
 *   (net, topDwell with jql null) stay non-clickable for panel.
 */
export default function KpiPulseBand({
  pulse,
  jiraBaseUrl,
  title = 'KPI pulse',
  onGenerateImpact,
  generatingImpact = false,
  domainHint,
  loading = false,
  error = null,
  onHeroClick,
}) {
  if (loading) {
    return (
      <section className="kpi-pulse" aria-busy="true">
        <h2>{title}</h2>
        <p className="kpi-pulse-muted">Loading pulse…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="kpi-pulse">
        <h2>{title}</h2>
        <p className="kpi-pulse-muted">{error}</p>
      </section>
    );
  }

  if (!pulse) {
    return (
      <section className="kpi-pulse">
        <h2>{title}</h2>
        <p className="kpi-pulse-muted">Pulse data is not available yet.</p>
      </section>
    );
  }

  const h = pulse.heroes || {};
  const net = h.netBurn;
  const netClass =
    net && typeof net.count === 'number'
      ? net.count < 0
        ? 'net-neg'
        : net.count > 0
          ? 'net-pos'
          : ''
      : '';
  const netSub =
    net && typeof net.count === 'number'
      ? net.count > 0
        ? 'catching up'
        : net.count < 0
          ? 'backlog growing'
          : 'even'
      : null;

  const agedDays = pulse.agedOpenDays || 14;
  const top = h.topDwellStatus;
  const errKeys = pulse.errors ? Object.keys(pulse.errors) : [];

  const openFn = (key, cell) => {
    if (!onHeroClick || !cell?.jql || !PULSE_PANEL_HERO_KEYS.has(key)) return undefined;
    return () => onHeroClick(key, cell);
  };

  return (
    <section className="kpi-pulse" aria-label={title}>
      <h2>{title}</h2>
      {pulse.window?.label ? (
        <p className="kpi-pulse-window">
          {pulse.window.label}
          {pulse.window.start && pulse.window.end
            ? ` · ${pulse.window.start} → ${pulse.window.end}`
            : null}
          {pulse.asOf ? ` · as of ${new Date(pulse.asOf).toLocaleString()}` : null}
        </p>
      ) : null}
      {pulse.story ? <p className="kpi-pulse-story">{pulse.story}</p> : null}

      {errKeys.length > 0 ? (
        <p className="kpi-pulse-warn" role="status">
          Some JIRA counts failed ({errKeys.length}) — treat zeros with caution.
        </p>
      ) : null}

      <div className="kpi-pulse-heroes">
        {h.p0Open ? (
          <PulseHero
            label="P0 open"
            cell={h.p0Open}
            sub="blockers"
            jiraBaseUrl={jiraBaseUrl}
            onOpen={openFn('p0Open', h.p0Open)}
          />
        ) : null}
        {h.p1Open ? (
          <PulseHero
            label="P1 open"
            cell={h.p1Open}
            sub="critical"
            jiraBaseUrl={jiraBaseUrl}
            onOpen={openFn('p1Open', h.p1Open)}
          />
        ) : null}
        <PulseHero
          label="Open now"
          cell={h.openNow}
          sub="still in flight"
          jiraBaseUrl={jiraBaseUrl}
          title="Open issues in KPI scope"
          onOpen={openFn('openNow', h.openNow)}
        />
        <PulseHero
          label="Net change"
          cell={net}
          sub={netSub}
          className={netClass}
          jiraBaseUrl={jiraBaseUrl}
          title="Resolved minus created in the window (not a single JIRA count — use Created / Resolved tiles)"
        />
        <PulseHero
          label={`Open ≥${agedDays}d`}
          cell={h.agedOpen}
          sub="created age"
          jiraBaseUrl={jiraBaseUrl}
          title="Open issues whose created date is at least N days ago"
          onOpen={openFn('agedOpen', h.agedOpen)}
        />
        {h.tbv ? (
          <PulseHero
            label="Awaiting QA"
            cell={h.tbv}
            sub="status Resolved"
            jiraBaseUrl={jiraBaseUrl}
            onOpen={openFn('tbv', h.tbv)}
          />
        ) : null}
        <PulseHero
          label="Created"
          cell={h.createdWindow}
          sub="new in window"
          jiraBaseUrl={jiraBaseUrl}
          onOpen={openFn('createdWindow', h.createdWindow)}
        />
        <PulseHero
          label="Resolved"
          cell={h.resolvedWindow}
          sub="resolutiondate in window"
          jiraBaseUrl={jiraBaseUrl}
          title="Issues with resolutiondate in the pulse window (not the same as →Closed in the chart)"
          onOpen={openFn('resolvedWindow', h.resolvedWindow)}
        />
        <PulseHero
          label="Typical wait"
          cell={h.mttrMedian}
          sub={
            h.mttrMedian?.truncated
              ? `n=${h.mttrMedian.sampleSize} (capped)`
              : h.mttrMedian?.sampleSize != null
                ? `n=${h.mttrMedian.sampleSize}`
                : 'median days'
          }
          jiraBaseUrl={jiraBaseUrl}
          title="Median created → resolved (opens resolved-in-window sample)"
          onOpen={openFn('mttrMedian', h.mttrMedian)}
        />
        <PulseHero
          label="Slow tail"
          cell={h.mttrP90}
          sub="p90 days"
          jiraBaseUrl={jiraBaseUrl}
          title="90th percentile created → resolved"
          onOpen={openFn('mttrP90', h.mttrP90)}
        />
        <PulseHero
          label="Where it stalls"
          cell={
            top?.status
              ? { count: top.count, unit: 'days', jql: null }
              : { count: null }
          }
          sub={top?.status || '—'}
          jiraBaseUrl={jiraBaseUrl}
          title="Highest median time in a non-Done status (changelog sample; not clickable)"
        />
      </div>

      <CreatedResolvedChart
        series={pulse.series}
        jiraBaseUrl={jiraBaseUrl}
        caption={pulse.seriesCaption}
        outflowMode={pulse.seriesOutflowMode || 'transitions'}
      />

      <div className="kpi-pulse-dwell-label">Where work stalls (median days · sample)</div>
      <StatusDwellTiles statusDwell={pulse.statusDwell} max={5} />

      <ProductImpactCard
        productImpact={pulse.productImpact}
        jiraBaseUrl={jiraBaseUrl}
        onGenerate={onGenerateImpact}
        generating={generatingImpact}
        domainHint={domainHint}
      />
    </section>
  );
}
