import React from 'react';

const JIRA_BASE = 'https://jira.nutanix.com';
const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export function jiraHref(base, jql) {
  if (!jql) return null;
  return `${String(base || JIRA_BASE).replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

export function ticketHref(base, key) {
  return `${String(base || JIRA_BASE).replace(/\/+$/, '')}/browse/${key}`;
}

/**
 * About = inferred sentence when present; else muted path/status line.
 * Do not paint "NAI limited" per row — use AboutInferenceBanner once on the drawer.
 */
export function AboutLine({ about, pathHint, loading }) {
  if (about) {
    return (
      <div className="oc-drill-about" title="Inferred from description + comment thread">
        <span className="oc-drill-about-text">{about}</span>
      </div>
    );
  }
  if (loading && !pathHint) {
    return <div className="oc-muted">Inferring situation…</div>;
  }
  if (pathHint) {
    return (
      <div className="oc-drill-about oc-drill-about-fallback">
        <span className="oc-drill-about-text oc-muted">{pathHint}</span>
      </div>
    );
  }
  return null;
}

/** One drawer note when About inference did not land — never repeat per row. */
export function AboutInferenceBanner({ keys, blurbs, loading }) {
  const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
  if (loading || !list.length || !blurbs) return null;
  const anyAbout = list.some((k) => Boolean(blurbs[k]?.about));
  if (anyAbout) return null;
  return (
    <p className="oc-muted oc-drill-about-banner" role="status">
      About unavailable — status and path shown below.
    </p>
  );
}

function Num({ cell, jiraBaseUrl, className, label }) {
  const count = cell?.count ?? 0;
  const href = jiraHref(jiraBaseUrl, cell?.jql);
  if (!href) return <span className={className}>{count}</span>;
  const name = label || 'tickets';
  return (
    <a
      className={`${className || ''} oc-jira-link`.trim()}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${count} ${name} in JIRA`}
      aria-label={`Open ${count} ${name} in JIRA`}
    >
      {count}
    </a>
  );
}

export function linkify(text, jiraBase) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  let match;
  let i = 0;
  TICKET_RE.lastIndex = 0;
  while ((match = TICKET_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = match[1];
    parts.push(
      <a key={`${key}-${i++}`} href={ticketHref(jiraBase, key)} target="_blank" rel="noopener noreferrer">
        {key}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function SummaryBody({ summary, jiraBase }) {
  if (!summary) return null;
  const lines = String(summary).split('\n');
  return (
    <div className="oc-ai-body">
      {lines.map((line, idx) => {
        if (line.startsWith('## ')) {
          return <h2 key={idx}>{linkify(line.replace(/^##\s+/, ''), jiraBase)}</h2>;
        }
        if (line.startsWith('### ')) {
          return <h3 key={idx}>{linkify(line.replace(/^###\s+/, ''), jiraBase)}</h3>;
        }
        if (!line.trim()) return <br key={idx} />;
        return <div key={idx}>{linkify(line, jiraBase)}</div>;
      })}
    </div>
  );
}

export function wowSub(wow) {
  const pct = wow?.pct ?? 0;
  const prev = wow?.prev ?? 0;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  return `${arrow}${Math.abs(pct)}% vs prior 7d (was ${prev})`;
}

export function Hero({ label, cell, sub, title, jiraBase, onOpen, tone }) {
  const count = cell?.count ?? 0;
  const jiraUrl = jiraHref(jiraBase, cell?.jql);
  const toneClass = tone ? ` oc-hero-${tone}` : '';
  // Distinct actions when drill exists: count → side panel, hint → JIRA.
  // Without onOpen, count itself is the JIRA link — hide the redundant hint.
  const showJiraHint = Boolean(jiraUrl && onOpen);
  const linkedClass = jiraUrl ? ' oc-hero-linked' : '';
  return (
    <div
      className={`oc-hero${linkedClass}${toneClass}`}
      title={
        title ||
        (onOpen
          ? `Show ${count} ${label} in panel`
          : jiraUrl
            ? `Open ${count} ${label} in JIRA`
            : undefined)
      }
    >
      <div className="label">{label}</div>
      {onOpen ? (
        <button
          type="button"
          className="value oc-hero-open"
          onClick={onOpen}
          aria-label={`Show ${label}: ${count} tickets`}
        >
          {count}
        </button>
      ) : (
        <Num cell={cell} jiraBaseUrl={jiraBase} className="value" label={label} />
      )}
      {sub ? <div className="sub">{sub}</div> : null}
      {showJiraHint ? (
        <a
          className="oc-hero-jira-hint"
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${count} ${label} in JIRA`}
          title={`Open ${count} ${label} in JIRA`}
        >
          Open in JIRA ↗
        </a>
      ) : null}
    </div>
  );
}

/** Sample-scope suffix when path chips are from a capped seed fetch (not full open universe). */
function sampleSub(paths, base) {
  const s = paths?.sample;
  if (!s?.capped) return base;
  const n = s.openFetched ?? s.fetched;
  const m = s.openTotal ?? s.closedTotal;
  if (n == null || m == null) return base;
  return `${base} · from ${n} of ${m}`;
}

/** Coverage band — who already has a path (not the chase list). */
export function PathHeroes({ paths, jiraBase, onOpen }) {
  if (!paths) return null;
  const open = (mode) => (onOpen ? () => onOpen(mode) : undefined);
  return (
    <div className="oc-heroes">
      <Hero
        label="TechHelp linked"
        cell={paths.withTechHelp}
        sub={sampleSub(paths, 'OnCalls with workaround · click list')}
        title="Open OnCalls that have TechHelp linked"
        jiraBase={jiraBase}
        onOpen={open('withTechHelp')}
        tone="monitor"
      />
      <Hero
        label="Eng / docs linked"
        cell={paths.withEng}
        sub={sampleSub(paths, 'OnCalls with fix linked · click list')}
        title="Open OnCalls that have eng/docs linked"
        jiraBase={jiraBase}
        onOpen={open('withEng')}
        tone="monitor"
      />
      <Hero
        label="TechPubs linked"
        cell={paths.withTechPubs}
        sub={sampleSub(paths, 'OnCalls with docs linked · click list')}
        title="Open OnCalls that have TechPubs linked"
        jiraBase={jiraBase}
        onOpen={open('withTechPubs')}
        tone="monitor"
      />
    </div>
  );
}

/**
 * Portfolio outcomes — what to do this week (gaps first), not the raw linked universe.
 * linkedOut (all statuses) stays as proof-only footprint.
 */
export function PortfolioOutcomes({ paths, jiraBase, onOpen }) {
  if (!paths) return null;
  const open = (mode) => (onOpen ? () => onOpen(mode) : undefined);
  const footprint = paths.linkedOut;
  const footprintHref = jiraHref(jiraBase, footprint?.jql);
  return (
    <>
      <div className="oc-heroes">
        <Hero
          label="Chase — no path"
          cell={paths.withoutRemediation}
          sub={sampleSub(paths, 'no TechHelp and no eng/docs · click list')}
          title="Open OnCalls with neither TechHelp nor eng/docs — chase first"
          jiraBase={jiraBase}
          onOpen={open('withoutRemediation')}
          tone="chase"
        />
        <Hero
          label="Need eng / docs"
          cell={paths.withoutEng}
          sub={sampleSub(paths, 'has TechHelp · still need a fix owner')}
          title="Open OnCalls that have TechHelp but no eng/docs link"
          jiraBase={jiraBase}
          onOpen={open('withoutEng')}
          tone="watch"
        />
        <Hero
          label="Need TechHelp"
          cell={paths.withoutTechHelp}
          sub={sampleSub(paths, 'no workaround ticket yet')}
          title="Open OnCalls with no TechHelp link"
          jiraBase={jiraBase}
          onOpen={open('withoutTechHelp')}
          tone="watch"
        />
        <Hero
          label="Eng / docs in flight"
          cell={paths.withEng}
          sub={sampleSub(paths, 'OnCalls with eng/docs linked · monitor')}
          title="Open OnCalls that already have eng/docs linked"
          jiraBase={jiraBase}
          onOpen={open('withEng')}
          tone="monitor"
        />
      </div>
      {footprint?.count != null && (
        <p className="oc-footprint">
          Linked footprint:{' '}
          {footprintHref ? (
            <a
              className="oc-jira-link"
              href={footprintHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full linked-downstream set in JIRA (all statuses)"
              aria-label={`Open linked footprint of ${footprint.count} tickets in JIRA`}
            >
              {footprint.count}
            </a>
          ) : (
            <strong>{footprint.count}</strong>
          )}{' '}
          tickets linked from the OnCalls KPI (all statuses) — graph size for proof, not this week’s chase list.
        </p>
      )}
    </>
  );
}

export function TicketsTable({ rows, jiraBase, mode = 'open' }) {
  if (!rows?.length) {
    return (
      <p className="oc-muted">
        {mode === 'past' ? 'No closed OnCalls in this window.' : 'No open OnCalls in scope.'}
      </p>
    );
  }
  return (
    <div className="oc-table-wrap">
      <table className="oc-table">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Issue Type</th>
            <th scope="col">Summary</th>
            <th scope="col">Status</th>
            {mode === 'past' ? <th scope="col">Resolution</th> : null}
            <th scope="col">Priority</th>
            <th scope="col">Assignee</th>
            <th scope="col">{mode === 'past' ? 'Cycle' : 'Age'}</th>
            <th scope="col">TechHelp</th>
            <th scope="col">Eng / TechPubs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <a href={ticketHref(jiraBase, row.key)} target="_blank" rel="noopener noreferrer">
                  {row.key}
                </a>
              </td>
              <td>{row.issueType || 'OnCall'}</td>
              <td className="oc-table-summary">{row.summary || '—'}</td>
              <td>{row.status || '—'}</td>
              {mode === 'past' ? <td>{row.resolution || 'N/A'}</td> : null}
              <td>{row.priority || '—'}</td>
              <td>{row.assignee || 'Unassigned'}</td>
              <td>
                {mode === 'past'
                  ? row.cycleDays != null
                    ? `${row.cycleDays}d`
                    : '—'
                  : row.ageDays != null
                    ? `${row.ageDays}d`
                    : '—'}
              </td>
              <td>
                {(row.techHelpKeys || []).length
                  ? row.techHelpKeys.map((k) => (
                      <a
                        key={k}
                        className="oc-table-link"
                        href={ticketHref(jiraBase, k)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {k}
                      </a>
                    ))
                  : '—'}
              </td>
              <td>
                {(row.engFixKeys || []).length
                  ? row.engFixKeys.map((k) => (
                      <a
                        key={k}
                        className="oc-table-link"
                        href={ticketHref(jiraBase, k)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {k}
                      </a>
                    ))
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { JIRA_BASE };
