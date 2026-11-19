import React, { useEffect, useMemo, useState } from 'react';
import { PageLoading } from '../../shared/components/PageLoading';
import { useDependencyView } from '../../hooks/useDependencyView';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import DirectionColumn from './DirectionColumn';
import DependencySwimlanes, { setSwimlaneHomeProjects } from './DependencySwimlanes';
import EarlyCallBundle from './EarlyCallBundle';
import TicketChip from './TicketChip';
import { buildHygieneItems } from './hygiene';
import './DependencyView.css';

/** Sub-tabs — one slice at a time (no stacked “everything”). */
const TABS = [
  {
    id: 'i_wait',
    label: 'We wait on them',
    hint: 'Our projects blocked by partners (is blocked by)',
  },
  {
    id: 'they_wait',
    label: 'They wait on us',
    hint: 'Outside-NDB partners blocked by us — Peer NDB pairs are under We wait',
  },
  {
    id: 'hygiene',
    label: 'What to fix',
    hint: 'Missing labels / links / commit hygiene',
  },
  {
    id: 'wishlist',
    label: 'Wishlist',
    hint: 'Projects we wish into this NDB release',
  },
  {
    id: 'train_asks',
    label: 'Train asks',
    hint: 'Ask labels on partner tickets',
  },
  {
    id: 'early_calls',
    label: 'Early calls',
    hint: 'Upcoming planned trains before CC/EC (label-based asks + wishlist)',
  },
  {
    id: 'partnership',
    label: 'Partnership',
    hint: 'Shared FEAT → Epic delivery roots (configured in companionRoots)',
  },
];

function trainDisplayName(train) {
  if (!train) return null;
  return train.displayName || train.train || null;
}

function trainStatusLabel(train) {
  if (!train) return null;
  return train.statusLabel || train.status || null;
}

/**
 * EW scope under wait tabs.
 * They wait: Outside NDB + FYI only — Peer NDB↔Peer NDB lives under We wait.
 */
const EW_SCOPES_WE = [
  {
    id: 'outside',
    label: 'Outside NDB',
    hint: 'global-ew + nutanix-ew (partners outside NDB)',
    spans: ['global_ew', 'nutanix_ew'],
  },
  {
    id: 'ndb_peer',
    label: 'Peer NDB',
    hint: 'ndb-ew — peer NDB teams (still NDB). Shown only under We wait on them.',
    spans: ['ndb_ew'],
  },
  {
    id: 'fyi',
    label: 'FYI / unparked',
    hint: 'No EW label — awareness only, not matrix Dependency',
    spans: ['team_internal'],
  },
];

const EW_SCOPES_THEY = [
  {
    id: 'outside',
    label: 'Outside NDB',
    hint: 'Partners outside NDB waiting on our tickets (global-ew + nutanix-ew)',
    spans: ['global_ew', 'nutanix_ew'],
  },
  {
    id: 'fyi',
    label: 'FYI / unparked',
    hint: 'Unlabeled partner tickets waiting on us',
    spans: ['team_internal'],
  },
];

function issueTypeId(iss) {
  if (iss?.spanInfo?.id != null) return String(iss.spanInfo.id);
  if (iss?.span != null) return String(iss.span);
  return 'team_internal';
}

function filterByEwScope(issues, ewScopeId, scopes) {
  if (!ewScopeId || ewScopeId === 'all') return issues || [];
  const scope = (scopes || EW_SCOPES_WE).find((s) => s.id === ewScopeId);
  // Unknown scope for this tab (e.g. ndb_peer on They wait) → empty, not “all”
  if (!scope) return [];
  const allowed = new Set(scope.spans);
  return (issues || []).filter((iss) => allowed.has(issueTypeId(iss)));
}

/** Match JIRA component name on partner tickets — any project. */
function filterByComponent(issues, componentName) {
  if (!componentName) return issues || [];
  return (issues || []).filter((iss) =>
    (iss.components || []).some((c) => c === componentName)
  );
}

function uniqueComponentNames(issues) {
  const names = new Set();
  (issues || []).forEach((iss) => {
    (iss.components || []).forEach((c) => {
      if (c) names.add(c);
    });
  });
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function withComponentClause(jql, componentName) {
  if (!jql || !componentName) return jql || '';
  const escaped = String(componentName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `(${jql}) AND component = "${escaped}"`;
}

function jiraUrlForJql(baseUrl, jql) {
  if (!baseUrl || !jql) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

function countByEwScope(issues, { excludeNdbHome = false } = {}) {
  const counts = { outside: 0, ndb_peer: 0, fyi: 0 };
  (issues || []).forEach((iss) => {
    if (excludeNdbHome && isNdbHomeIssue(iss)) return;
    const id = issueTypeId(iss);
    if (id === 'global_ew' || id === 'nutanix_ew') counts.outside += 1;
    else if (id === 'ndb_ew') counts.ndb_peer += 1;
    else counts.fyi += 1;
  });
  return counts;
}

/** Team home: selectedTeam.homeProjects if set, else ERA/FEAT/NDB* fallback. */
function isHomeIssue(iss, homeProjects) {
  const pk = String(iss?.project || String(iss?.key || '').split('-')[0] || '').toUpperCase();
  if (Array.isArray(homeProjects) && homeProjects.length) {
    return homeProjects.some((p) => String(p).toUpperCase() === pk);
  }
  return pk === 'ERA' || pk === 'FEAT' || pk.startsWith('NDB');
}
function isNdbHomeIssue(iss) {
  // Back-compat alias — callers that already have team context should use isHomeIssue(iss, selectedTeam?.homeProjects)
  return isHomeIssue(iss, null);
}

function Metric({ section, label }) {
  if (!section) return null;
  const count = section.count ?? section.issues?.length ?? 0;
  const href = section.jiraUrl;
  if (!href) {
    return (
      <span className="dv-meta">
        {label}: {count}
      </span>
    );
  }
  return (
    <a
      className="dv-meta"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={section.jql || ''}
      aria-label={`${label}: ${count} — open in JIRA`}
    >
      {label}: {count}
    </a>
  );
}

export default function DependencyViewPage() {
  const { selectedTeamId, selectedTeam, hasTeamSelected } = useTeam();
  const [release, setRelease] = useState('');
  const [tab, setTab] = useState('i_wait');
  const [ewScope, setEwScope] = useState('outside');
  /** Partner component name; '' = all components (any project). */
  const [componentFilter, setComponentFilter] = useState('');

  const { data, loading, refreshing, error, refresh } = useDependencyView(
    selectedTeamId,
    release || undefined
  );

  useEffect(() => {
    setRelease('');
    if (selectedTeam?.homeProjects?.length) setSwimlaneHomeProjects(selectedTeam.homeProjects);
    else setSwimlaneHomeProjects(null);
  }, [selectedTeamId, selectedTeam?.homeProjects]);

  useEffect(() => {
    if (!data) return;
    if (!release && data.release) setRelease(data.release);
  }, [data, release]);

  const releases = data?.releases?.length ? data.releases : [];
  const jiraBaseUrl = data?.jiraBaseUrl || 'https://jira.nutanix.com';
  const train = data?.alignedTrain || {};
  const sections = useMemo(() => data?.sections || {}, [data?.sections]);
  const selectedRelease = release || data?.release || '';
  const fetching =
    Boolean(loading || refreshing) ||
    Boolean(selectedRelease && data?.release && data.release !== selectedRelease);

  /** Unfiltered direction lists — main tab badges use these. */
  const iWaitAll = useMemo(
    () => sections.partnershipBlockedBy?.issues || [],
    [sections.partnershipBlockedBy]
  );
  const theyWaitAll = useMemo(
    () => sections.partnershipBlocks?.issues || [],
    [sections.partnershipBlocks]
  );

  /** EW-scoped before component filter — drives component dropdown options. */
  const iWaitByEw = useMemo(
    () => filterByEwScope(iWaitAll, ewScope, EW_SCOPES_WE),
    [iWaitAll, ewScope]
  );
  /** They wait EW scope: never list home tickets (those are We-wait / Peer). */
  const theyWaitByEw = useMemo(() => {
    const scoped = filterByEwScope(theyWaitAll, ewScope, EW_SCOPES_THEY);
    return scoped.filter((t) => !isHomeIssue(t, selectedTeam?.homeProjects));
  }, [theyWaitAll, ewScope, selectedTeam?.homeProjects]);

  /** EW + component — used inside We wait / They wait panels. */
  const iWait = useMemo(
    () => filterByComponent(iWaitByEw, componentFilter),
    [iWaitByEw, componentFilter]
  );
  const theyWait = useMemo(
    () => filterByComponent(theyWaitByEw, componentFilter),
    [theyWaitByEw, componentFilter]
  );

  const componentOptions = useMemo(
    () => uniqueComponentNames(tab === 'they_wait' ? theyWaitByEw : iWaitByEw),
    [tab, iWaitByEw, theyWaitByEw]
  );

  const iWaitJql = useMemo(
    () => withComponentClause(sections.partnershipBlockedBy?.jql, componentFilter),
    [sections.partnershipBlockedBy?.jql, componentFilter]
  );
  const iWaitJiraUrl = useMemo(
    () =>
      componentFilter
        ? jiraUrlForJql(jiraBaseUrl, iWaitJql)
        : sections.partnershipBlockedBy?.jiraUrl || '',
    [componentFilter, jiraBaseUrl, iWaitJql, sections.partnershipBlockedBy?.jiraUrl]
  );
  const theyWaitJql = useMemo(
    () => withComponentClause(sections.partnershipBlocks?.jql, componentFilter),
    [sections.partnershipBlocks?.jql, componentFilter]
  );
  const theyWaitJiraUrl = useMemo(
    () =>
      componentFilter
        ? jiraUrlForJql(jiraBaseUrl, theyWaitJql)
        : sections.partnershipBlocks?.jiraUrl || '',
    [componentFilter, jiraBaseUrl, theyWaitJql, sections.partnershipBlocks?.jiraUrl]
  );

  // Drop stale component selection when EW scope / tab options change
  useEffect(() => {
    if (!componentFilter) return;
    if (!componentOptions.includes(componentFilter)) setComponentFilter('');
  }, [componentFilter, componentOptions]);

  const trainAsks = useMemo(
    () => sections.trainLabels?.issues || [],
    [sections.trainLabels]
  );
  const wishlist = useMemo(() => sections.wishlist?.issues || [], [sections.wishlist]);
  /**
   * Team-side *wait roots* (Project column) — not the FEAT/ENG blockers themselves.
   * Includes wishlist + server waitRoots (e.g. ERA-49565) + home keys linked from blockers.
   */
  const projectIssues = useMemo(() => {
    const blockerKeys = new Set([...(iWait || []), ...(theyWait || [])].map((i) => i.key));
    const byKey = new Map();
    const add = (iss) => {
      if (!iss?.key || blockerKeys.has(iss.key)) return;
      byKey.set(iss.key, iss);
    };
    (wishlist || []).forEach(add);
    (sections.waitRoots?.issues || []).forEach(add);
    // Home tickets referenced on blocker links (ERA-49565 ← blocks ← FEAT-18273)
    (iWait || []).forEach((blocker) => {
      (blocker.links || []).forEach((link) => {
        if (!link?.key || blockerKeys.has(link.key)) return;
        const pk = String(link.project || String(link.key).split('-')[0] || '').toUpperCase();
        if (!isHomeIssue({ project: pk, key: link.key }, selectedTeam?.homeProjects)) return;
        const stub = {
          key: link.key,
          summary: link.summary || link.key,
          project: pk,
          status: link.status || '',
          issueType: link.issueType || '',
          links: [],
          labels: link.labels || [],
        };
        const existing = byKey.get(link.key);
        if (!existing) {
          byKey.set(link.key, stub);
          return;
        }
        // Never let a thin link stub wipe status/type from a fetched issue
        byKey.set(link.key, {
          ...stub,
          ...existing,
          status: existing.status || stub.status,
          issueType: existing.issueType || stub.issueType,
          summary: existing.summary || stub.summary,
        });
      });
    });
    return [...byKey.values()];
  }, [wishlist, iWait, theyWait, sections.waitRoots]);

  const chainExtras = useMemo(
    () => [...(sections.blockerHops?.issues || []), ...(sections.waitRoots?.issues || [])],
    [sections.blockerHops, sections.waitRoots]
  );
  const wishlistUnlinked = useMemo(
    () => sections.wishlistUnlinked?.issues || [],
    [sections.wishlistUnlinked]
  );
  const orphans = useMemo(
    () => sections.partnerOrphans?.issues || [],
    [sections.partnerOrphans]
  );

  const earlyCalls = useMemo(() => {
    const raw = data?.earlyCalls || sections.earlyCalls || [];
    return (raw || []).map((bundle) => {
      const s = bundle.sections || {};
      return {
        ...bundle,
        trainAsks: s.trainLabels?.issues || [],
        wishlistItems: s.wishlist?.issues || [],
        wishlistUnlinkedItems: s.wishlistUnlinked?.issues || [],
        orphanAsks: s.partnerOrphans?.issues || [],
      };
    });
  }, [data?.earlyCalls, sections.earlyCalls]);

  const hygiene = useMemo(
    () =>
      buildHygieneItems({
        iWaitIssues: iWaitAll,
        theyWaitIssues: theyWaitAll,
        wishlistCount: wishlist.length,
        wishlistUnlinked,
        partnerOrphans: orphans,
        sections,
        jiraBaseUrl,
        trainName: train.train,
      }),
    [
      iWaitAll,
      theyWaitAll,
      wishlist.length,
      wishlistUnlinked,
      orphans,
      sections,
      jiraBaseUrl,
      train.train,
    ]
  );

  const companions = sections.companions || [];

  const theyWaitOutsideCount = useMemo(
    () => theyWaitAll.filter((t) => !isNdbHomeIssue(t)).length,
    [theyWaitAll]
  );

  const tabCounts = useMemo(
    () => ({
      i_wait: iWaitAll.length,
      they_wait: theyWaitOutsideCount,
      hygiene: hygiene.length,
      wishlist: wishlist.length,
      train_asks: trainAsks.length,
      early_calls: earlyCalls.reduce(
        (n, b) => n + (b.trainAsks?.length || 0) + (b.wishlistItems?.length || 0),
        0
      ),
      partnership: companions.length,
    }),
    [
      iWaitAll.length,
      theyWaitOutsideCount,
      hygiene.length,
      wishlist.length,
      trainAsks.length,
      earlyCalls,
      companions.length,
    ]
  );

  const showIWait = tab === 'i_wait';
  const showTheyWait = tab === 'they_wait';
  const showHygiene = tab === 'hygiene';
  const showTrain = tab === 'train_asks';
  const showWishlist = tab === 'wishlist';
  const showEarlyCalls = tab === 'early_calls';
  const showPartnership = tab === 'partnership';
  const showEwScopes = showIWait || showTheyWait;
  const ewScopesForTab = showTheyWait ? EW_SCOPES_THEY : EW_SCOPES_WE;
  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const activeEwMeta =
    ewScopesForTab.find((s) => s.id === ewScope) || ewScopesForTab[0];

  // They wait has no Peer NDB subtab — always leave ndb_peer
  useEffect(() => {
    if (!showTheyWait) return;
    if (ewScope === 'ndb_peer' || !EW_SCOPES_THEY.some((s) => s.id === ewScope)) {
      setEwScope('outside');
    }
  }, [showTheyWait, ewScope]);

  const ewScopeCounts = useMemo(() => {
    // They wait: Outside + FYI only; never surface a Peer NDB “1” from ERA home tickets
    if (showTheyWait) {
      const c = countByEwScope(theyWaitAll, { excludeNdbHome: true });
      return { outside: c.outside, fyi: c.fyi };
    }
    return countByEwScope(iWaitAll);
  }, [showTheyWait, iWaitAll, theyWaitAll]);

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Post EC dependency view"
        description="Select a team in the sidebar to load cross-team dependencies."
      />
    );
  }

  return (
    <div className="dv-page">
      <header className="dv-header">
        <h1>Post EC dependency view</h1>
        <span className="dv-badge">read-only</span>
        {selectedTeam?.name ? (
          <span className="dv-meta">{selectedTeam.name}</span>
        ) : null}
        {data?.asOf ? (
          <span className="dv-meta">as of {new Date(data.asOf).toLocaleString()}</span>
        ) : null}
      </header>

      <div className="dv-filters dv-filters--release">
        <label>
          Release
          <select
            value={selectedRelease}
            onChange={(e) => setRelease(e.target.value)}
            aria-label="Release"
          >
            {!selectedRelease ? <option value="">Select…</option> : null}
            {releases.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => refresh()} disabled={fetching}>
          {fetching ? 'Fetching…' : 'Pull from JIRA'}
        </button>
      </div>

      {error ? <div className="dv-error">{error}</div> : null}
      {fetching && data ? (
        <div className="dv-banner">Fetching {selectedRelease} — view updates when ready.</div>
      ) : null}

      {train.train || train.status ? (
        <div className="dv-train">
          <div>
            <strong>{selectedRelease || '—'}</strong>
            {' ↔ '}
            <strong>{trainDisplayName(train) || 'No partner train configured'}</strong>
            {trainStatusLabel(train) ? (
              <span className="dv-badge" style={{ marginLeft: '0.35rem' }}>
                {trainStatusLabel(train)}
              </span>
            ) : null}
          </div>
          {train.notes ? <p className="dv-col-sub">{train.notes}</p> : null}
          {train.askLabelHint ? (
            <p className="dv-col-sub">
              Partner ask labels on their tickets:{' '}
              <code className="dv-code">{train.askLabelHint}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="dv-metrics" aria-label="Release snapshot">
        <Metric
          section={{ ...sections.partnershipBlockedBy, count: iWaitAll.length }}
          label="We wait on partners"
        />
        <Metric
          section={{ ...sections.partnershipBlocks, count: theyWaitAll.length }}
          label="Partners wait on us"
        />
        <Metric
          section={{ ...sections.wishlist, count: wishlist.length }}
          label="Our wishlist projects"
        />
        <Metric
          section={{ ...sections.trainLabels, count: trainAsks.length }}
          label="Ask labels on partner tickets"
        />
      </div>

      <div className="dv-tabs" role="tablist" aria-label="Dependency view sections">
        {TABS.map((t) => {
          const count = tabCounts[t.id];
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`dv-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`dv-panel-${t.id}`}
              className={`dv-tab${selected ? ' dv-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
              title={t.hint}
            >
              <span className="dv-tab-label">{t.label}</span>
              {typeof count === 'number' ? (
                <span className="dv-tab-count">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="dv-tab-hint">{activeTabMeta.hint}</p>

      {showEwScopes ? (
        <>
          <div
            className="dv-subtabs"
            role="tablist"
            aria-label="Partner EW type for this wait direction"
          >
            {ewScopesForTab.map((s) => {
              const count = ewScopeCounts[s.id] ?? 0;
              const selected = ewScope === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`dv-ew-${s.id}`}
                  aria-selected={selected}
                  className={`dv-subtab${selected ? ' dv-subtab--active' : ''}`}
                  onClick={() => setEwScope(s.id)}
                  title={s.hint}
                >
                  <span>{s.label}</span>
                  <span className="dv-tab-count">{count}</span>
                </button>
              );
            })}
          </div>
          <p className="dv-tab-hint">{activeEwMeta.hint}</p>
          <div className="dv-component-filter">
            <label>
              Component
              <select
                value={componentFilter}
                onChange={(e) => setComponentFilter(e.target.value)}
                aria-label="Filter by partner component"
              >
                <option value="">All components</option>
                {componentOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {componentFilter ? (
              <p className="dv-tab-hint">
                {showIWait
                  ? `NDB waits on partners with component ${componentFilter}`
                  : `Partners with component ${componentFilter} waiting on NDB`}
              </p>
            ) : null}
          </div>
          {showTheyWait ? (
            <p className="dv-tab-hint">
              Peer NDB ↔ Peer NDB (e.g. ERA epic blocked by ERA bug) is under{' '}
              <button
                type="button"
                className="dv-text-btn"
                onClick={() => {
                  setTab('i_wait');
                  setEwScope('ndb_peer');
                }}
              >
                We wait on them → Peer NDB
              </button>
              .
            </p>
          ) : null}
        </>
      ) : null}

      {showIWait && data ? (
        <div
          role="tabpanel"
          id="dv-panel-i_wait"
          aria-labelledby="dv-tab-i_wait"
          className="dv-tab-panel"
        >
          <DependencySwimlanes
            iWaitIssues={iWait}
            theyWaitIssues={[]}
            projectIssues={projectIssues}
            chainExtras={chainExtras}
            jiraBaseUrl={jiraBaseUrl}
            iWaitJiraUrl={iWaitJiraUrl}
            iWaitJql={iWaitJql}
            showIWait
            showTheyWait={false}
            title={`We wait on them — ${activeEwMeta.label}${
              componentFilter ? ` · ${componentFilter}` : ''
            }`}
            weWaitHeading="Our project → waits on → partner"
            previouslyLinked={data.previouslyLinked}
          />
          <details className="dv-drill">
            <summary>Full ticket list (drill-in) — {activeEwMeta.label}</summary>
            <DirectionColumn
              title={`We wait on them (${activeEwMeta.label}${
                componentFilter ? ` · ${componentFilter}` : ''
              })`}
              subtitle={
                componentFilter
                  ? `Partner tickets with component ${componentFilter}`
                  : activeEwMeta.hint
              }
              issues={iWait}
              jiraBaseUrl={jiraBaseUrl}
              jiraUrl={iWaitJiraUrl}
              jql={iWaitJql}
              emptyHint={`No “we wait on them” tickets in ${activeEwMeta.label} for current filters.`}
            />
          </details>
        </div>
      ) : null}

      {showTheyWait && data ? (
        <div
          role="tabpanel"
          id="dv-panel-they_wait"
          aria-labelledby="dv-tab-they_wait"
          className="dv-tab-panel"
        >
          <DependencySwimlanes
            iWaitIssues={iWaitAll}
            theyWaitIssues={theyWait}
            projectIssues={projectIssues}
            chainExtras={chainExtras}
            jiraBaseUrl={jiraBaseUrl}
            theyWaitJiraUrl={theyWaitJiraUrl}
            theyWaitJql={theyWaitJql}
            showIWait={false}
            showTheyWait
            title={`They wait on us — ${activeEwMeta.label}${
              componentFilter ? ` · ${componentFilter}` : ''
            }`}
            previouslyLinked={data.previouslyLinked}
            story={
              <>
                Outside partners waiting on our NDB tickets. Read left → right:{' '}
                <strong>Partner</strong>
                <span className="dv-edge-arrow-line"> → waits on → </span>
                <strong>Our ticket</strong>. Peer NDB pairs are not listed here.
                {componentFilter ? (
                  <>
                    {' '}
                    Showing component <strong>{componentFilter}</strong>.
                  </>
                ) : null}
              </>
            }
            legend={
              <>
                <strong>Partner (outside NDB)</strong>
                <span className="dv-edge-arrow-line">→ waits on →</span>
                <strong>Our ticket</strong>
              </>
            }
          />
          {theyWait.length > 0 ? (
            <details className="dv-drill">
              <summary>Full ticket list (drill-in) — {activeEwMeta.label}</summary>
              <DirectionColumn
                title={`They wait on us (${activeEwMeta.label}${
                  componentFilter ? ` · ${componentFilter}` : ''
                })`}
                subtitle={
                  componentFilter
                    ? `Partner tickets with component ${componentFilter}`
                    : activeEwMeta.hint
                }
                issues={theyWait}
                jiraBaseUrl={jiraBaseUrl}
                jiraUrl={theyWaitJiraUrl}
                jql={theyWaitJql}
                emptyHint="None for this filter."
                hideEmptyBuckets
              />
            </details>
          ) : (
            <p className="dv-empty">
              {componentFilter
                ? `No partners with component ${componentFilter} waiting on us in ${activeEwMeta.label}.`
                : `No outside-NDB partners waiting on us in ${activeEwMeta.label}. For ERA↔ERA (Peer NDB) deps, open We wait on them → Peer NDB.`}
            </p>
          )}
        </div>
      ) : null}

      {showHygiene ? (
        <div
          role="tabpanel"
          id="dv-panel-hygiene"
          aria-labelledby="dv-tab-hygiene"
          className="dv-tab-panel"
        >
          {hygiene.length > 0 ? (
            <section className="dv-hygiene" aria-label="What to fix">
              <h2>What to fix (whose fault)</h2>
              <ul>
                {hygiene.map((h) => (
                  <li key={h.id} className={`owner-${h.owner}`}>
                    <strong>
                      {h.owner === 'ndb'
                        ? 'Our fault (NDB process)'
                        : 'Partner fault (ticket owner)'}
                    </strong>
                    {' — '}
                    {h.jiraUrl ? (
                      <a
                        href={h.jiraUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={h.jql || ''}
                      >
                        {h.title}
                      </a>
                    ) : (
                      <span>{h.title}</span>
                    )}
                    <span className="dv-meta"> ({h.count})</span>
                    {h.detail ? <div className="dv-hygiene-detail">{h.detail}</div> : null}
                    <div className="dv-hygiene-examples">
                      {(h.examples || []).map((ex) => (
                        <a key={ex.key} href={ex.href} target="_blank" rel="noopener noreferrer">
                          {ex.summary}
                          {ex.fixVersion ? (
                            <span className="dv-meta"> · {ex.fixVersion}</span>
                          ) : null}
                        </a>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : data && !fetching ? (
            <section className="dv-hygiene">
              <h2>What to fix</h2>
              <p className="dv-empty">Nothing to chase for the current filters.</p>
            </section>
          ) : (
            <PageLoading inline message="Loading hygiene…" />
          )}
        </div>
      ) : null}

      {showEarlyCalls && data ? (
        <div
          role="tabpanel"
          id="dv-panel-early_calls"
          aria-labelledby="dv-tab-early_calls"
          className="dv-tab-panel"
        >
          <section className="dv-section dv-early" aria-label="Early calls on upcoming trains">
            <h2>Early calls — upcoming trains</h2>
            <p className="dv-col-sub">
              Releases where CC / EC (and often fixVersion) are not in play yet. Each train shows{' '}
              <strong>our wishlist → waits on → partner asks</strong>. Missing Mode Dependency
              links are under “Missing arrows.”
            </p>
            {earlyCalls.length > 0 ? (
              earlyCalls.map((bundle) => (
                <EarlyCallBundle
                  key={bundle.release}
                  bundle={bundle}
                  jiraBaseUrl={jiraBaseUrl}
                  defaultOpen
                />
              ))
            ) : (
              <p className="dv-empty">
                No planned / later releases after {selectedRelease || 'this release'} in config.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {showWishlist && data ? (
        <div
          role="tabpanel"
          id="dv-panel-wishlist"
          aria-labelledby="dv-tab-wishlist"
          className="dv-tab-panel"
        >
          <section className="dv-section">
            <h2>Projects we wish into this NDB release</h2>
            <p className="dv-col-sub">
              Wishlist labels live on <strong>our</strong> NDB projects — “I wish this project lands
              in {selectedRelease || 'this release'}.”
            </p>
            <div className="dv-meta" style={{ marginBottom: '0.35rem' }}>
              <Metric
                section={{ ...sections.wishlist, count: wishlist.length }}
                label="Wishlist projects"
              />
              {' · '}
              <Metric
                section={{ ...sections.wishlistUnlinked, count: wishlistUnlinked.length }}
                label="Wishlist with no link yet"
              />
            </div>
            <div className="dv-col-body">
              {wishlist.length === 0 ? (
                <p className="dv-empty">No wishlist items.</p>
              ) : (
                wishlist.map((iss) => (
                  <TicketChip
                    key={iss.key}
                    issue={iss}
                    jiraBaseUrl={jiraBaseUrl}
                    showAskFlags={false}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {showTrain && data ? (
        <div
          role="tabpanel"
          id="dv-panel-train_asks"
          aria-labelledby="dv-tab-train_asks"
          className="dv-tab-panel"
        >
          <section className="dv-section">
            <h2>
              Asks we labeled on partner tickets
              {trainDisplayName(train) ? ` — ${trainDisplayName(train)}` : ''}
            </h2>
            <p className="dv-col-sub">
              Labels sit on the <strong>partner’s</strong> ticket for this release’s train
              {train.askLabelHint ? (
                <>
                  {' '}
                  (<code className="dv-code">{train.askLabelHint}</code>)
                </>
              ) : null}
              — not the same as a wishlist on our NDB project.
            </p>
            <div className="dv-meta" style={{ marginBottom: '0.35rem' }}>
              <Metric
                section={{ ...sections.trainLabels, count: trainAsks.length }}
                label="Partner tickets with an ask label"
              />
            </div>
            <div className="dv-col-body">
              {trainAsks.length === 0 ? (
                <p className="dv-empty">No ask labels found on partner tickets for this train.</p>
              ) : (
                trainAsks.map((iss) => (
                  <TicketChip
                    key={iss.key}
                    issue={iss}
                    jiraBaseUrl={jiraBaseUrl}
                    showAskFlags={false}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {showPartnership && data ? (
        <div
          role="tabpanel"
          id="dv-panel-partnership"
          aria-labelledby="dv-tab-partnership"
          className="dv-tab-panel"
        >
          <section className="dv-section">
            <h2>Shared project delivery (Partnership)</h2>
            <p className="dv-col-sub">
              Multiple teams delivering as <strong>one project</strong> under a FEAT / Initiative →
              Epic hierarchy — not a blocks/blocked-by Dependency link. Roots come from{' '}
              <code className="dv-code">companionRoots</code> in dependency view config (real FEAT /
              Initiative keys only).
            </p>
            {!companions.length ? (
              <p className="dv-empty">
                No partnership roots configured for {selectedRelease || 'this release'}. Add real
                FEAT / Initiative keys to <code className="dv-code">companionRoots</code> when a
                shared-delivery project should appear here — do not use placeholder tickets.
              </p>
            ) : (
              companions.map((c) => (
                <details key={c.rootKey} open>
                  <summary>
                    {c.label || c.rootKey}{' '}
                    <span className="dv-meta">
                      external work {c.external?.count ?? 0} · full hierarchy{' '}
                      {c.hierarchy?.count ?? 0}
                    </span>
                    {c.external?.jiraUrl ? (
                      <>
                        {' · '}
                        <a
                          href={c.external.jiraUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={c.external.jql || ''}
                        >
                          JIRA
                        </a>
                      </>
                    ) : null}
                  </summary>
                  <div className="dv-col-body">
                    {(c.external?.issues || []).slice(0, 20).map((iss) => (
                      <TicketChip
                        key={iss.key}
                        issue={iss}
                        jiraBaseUrl={jiraBaseUrl}
                        showAskFlags={false}
                      />
                    ))}
                  </div>
                </details>
              ))
            )}
          </section>
        </div>
      ) : null}

      {!data && loading ? <PageLoading message="Loading dependencies…" /> : null}
    </div>
  );
}
