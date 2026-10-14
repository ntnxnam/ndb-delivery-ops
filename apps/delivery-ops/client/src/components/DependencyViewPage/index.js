import React, { useEffect, useMemo, useState } from 'react';
import { useDependencyView } from '../../hooks/useDependencyView';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import DirectionColumn from './DirectionColumn';
import DependencySwimlanes from './DependencySwimlanes';
import TicketChip from './TicketChip';
import { buildHygieneItems } from './hygiene';
import './DependencyView.css';

const SHOW_OPTIONS = [
  { id: 'everything', label: 'Everything for this release' },
  { id: 'i_wait', label: 'Work we are blocked on' },
  { id: 'they_wait', label: 'Work that is blocked on us' },
  {
    id: 'train_asks',
    label: 'Asks we labeled on partner tickets (train labels)',
  },
  { id: 'wishlist', label: 'Projects we wish into this NDB release' },
  {
    id: 'early_calls',
    label: 'Early calls on upcoming trains (e.g. Leto / NDB-3.1)',
  },
  { id: 'partnership', label: 'Shared project delivery (one hierarchy)' },
];

/** When sidebar team is NDB: ndb-ew = peer NDB teams (still NDB), not “other teams”. */
const PROJECT_TYPE_OPTIONS = [
  { id: 'all', label: 'Any partner type' },
  { id: 'global_ew', label: 'Global engineering work' },
  { id: 'nutanix_ew', label: 'Nutanix teams outside NDB' },
  { id: 'ndb_ew', label: 'Peer NDB teams (still NDB)' },
  { id: 'team_internal', label: 'Same squad / no EW label (FYI only)' },
];

function issueTypeId(iss) {
  if (iss?.spanInfo?.id != null) return String(iss.spanInfo.id);
  if (iss?.span != null) return String(iss.span);
  return 'team_internal';
}

function filterByProjectType(issues, projectType) {
  if (!projectType || projectType === 'all') return issues || [];
  return (issues || []).filter((iss) => issueTypeId(iss) === String(projectType));
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
  const [show, setShow] = useState('everything');
  const [projectType, setProjectType] = useState('all');

  const { data, loading, refreshing, error, refresh } = useDependencyView(
    selectedTeamId,
    release || undefined
  );

  useEffect(() => {
    setRelease('');
  }, [selectedTeamId]);

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

  const iWait = useMemo(
    () => filterByProjectType(sections.partnershipBlockedBy?.issues, projectType),
    [sections.partnershipBlockedBy, projectType]
  );
  const theyWait = useMemo(
    () => filterByProjectType(sections.partnershipBlocks?.issues, projectType),
    [sections.partnershipBlocks, projectType]
  );
  const trainAsks = useMemo(
    () => filterByProjectType(sections.trainLabels?.issues, projectType),
    [sections.trainLabels, projectType]
  );
  const wishlist = useMemo(
    () => filterByProjectType(sections.wishlist?.issues, projectType),
    [sections.wishlist, projectType]
  );
  /**
   * NDB-side *wait roots* (Project column) — not the FEAT/ENG blockers themselves.
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
        if (pk !== 'ERA' && pk !== 'FEAT' && !pk.startsWith('NDB')) return;
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
    () => filterByProjectType(sections.wishlistUnlinked?.issues, projectType),
    [sections.wishlistUnlinked, projectType]
  );
  const orphans = useMemo(
    () => filterByProjectType(sections.partnerOrphans?.issues, projectType),
    [sections.partnerOrphans, projectType]
  );

  const showIWait = show === 'everything' || show === 'i_wait';
  const showTheyWait = show === 'everything' || show === 'they_wait';
  const showTrain = show === 'everything' || show === 'train_asks';
  const showWishlist = show === 'everything' || show === 'wishlist';
  const showEarlyCalls = show === 'everything' || show === 'early_calls';
  const showPartnership = show === 'everything' || show === 'partnership';

  const earlyCalls = useMemo(() => {
    const raw = data?.earlyCalls || sections.earlyCalls || [];
    return (raw || []).map((bundle) => {
      const s = bundle.sections || {};
      return {
        ...bundle,
        trainAsks: filterByProjectType(s.trainLabels?.issues, projectType),
        wishlistItems: filterByProjectType(s.wishlist?.issues, projectType),
        wishlistUnlinkedItems: filterByProjectType(s.wishlistUnlinked?.issues, projectType),
        orphanAsks: filterByProjectType(s.partnerOrphans?.issues, projectType),
      };
    });
  }, [data?.earlyCalls, sections.earlyCalls, projectType]);

  const hygiene = useMemo(
    () =>
      buildHygieneItems({
        iWaitIssues: iWait,
        theyWaitIssues: theyWait,
        wishlistCount: wishlist.length,
        wishlistUnlinked,
        partnerOrphans: orphans,
        sections,
        jiraBaseUrl,
        trainName: train.train,
      }),
    [
      iWait,
      theyWait,
      wishlist.length,
      wishlistUnlinked,
      orphans,
      sections,
      jiraBaseUrl,
      train.train,
    ]
  );

  const companions = sections.companions || [];

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Dependency View"
        description="Select a team in the sidebar to load cross-team dependencies."
      />
    );
  }

  return (
    <div className="dv-page">
      <header className="dv-header">
        <h1>Dependency View</h1>
        <span className="dv-badge">read-only</span>
        {selectedTeam?.name ? (
          <span className="dv-meta">{selectedTeam.name}</span>
        ) : null}
        {data?.asOf ? (
          <span className="dv-meta">as of {new Date(data.asOf).toLocaleString()}</span>
        ) : null}
      </header>

      <div className="dv-filters">
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
        <label>
          What do you want to look at?
          <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
            {SHOW_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Partner type
          <select
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            aria-label="Partner type"
          >
            {PROJECT_TYPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
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
          This NDB release (<strong>{selectedRelease || '—'}</strong>) is meant to ship with
          partner train <strong>{train.train || 'unaligned / reassess'}</strong>
          {train.status ? ` (${train.status})` : ''}
          {train.notes ? ` — ${train.notes}` : ''}. Partner asks use labels for that train (for
          example ndb-leto-ask) — including peer NDB teams and partners outside NDB.
        </div>
      ) : null}

      <div className="dv-header" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <Metric
          section={{ ...sections.partnershipBlockedBy, count: iWait.length }}
          label="We wait on partners"
        />
        <Metric
          section={{ ...sections.partnershipBlocks, count: theyWait.length }}
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

      {(showIWait || showTheyWait) && data ? (
        <DependencySwimlanes
          iWaitIssues={iWait}
          theyWaitIssues={theyWait}
          projectIssues={projectIssues}
          chainExtras={chainExtras}
          jiraBaseUrl={jiraBaseUrl}
          iWaitJiraUrl={sections.partnershipBlockedBy?.jiraUrl}
          iWaitJql={sections.partnershipBlockedBy?.jql}
          theyWaitJiraUrl={sections.partnershipBlocks?.jiraUrl}
          theyWaitJql={sections.partnershipBlocks?.jql}
          showIWait={showIWait}
          showTheyWait={showTheyWait}
        />
      ) : null}

      {hygiene.length > 0 ? (
        <section className="dv-hygiene" aria-label="What to fix">
          <h2>What to fix (whose fault)</h2>
          <ul>
            {hygiene.map((h) => (
              <li key={h.id} className={`owner-${h.owner}`}>
                <strong>
                  {h.owner === 'ndb' ? 'Our fault (NDB process)' : 'Partner fault (ticket owner)'}
                </strong>
                {' — '}
                {h.jiraUrl ? (
                  <a href={h.jiraUrl} target="_blank" rel="noopener noreferrer" title={h.jql || ''}>
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
      ) : null}

      {(showIWait || showTheyWait) && data ? (
        <details className="dv-drill">
          <summary>Full ticket lists (drill-in)</summary>
          <div className="dv-cols">
            {showIWait ? (
              <DirectionColumn
                title="We are waiting on a partner"
                subtitle="JIRA “is blocked by” — partners can be peer NDB teams (ndb-ew) or teams outside NDB"
                issues={iWait}
                jiraBaseUrl={jiraBaseUrl}
                jiraUrl={sections.partnershipBlockedBy?.jiraUrl}
                jql={sections.partnershipBlockedBy?.jql}
                emptyHint="No tickets are blocking us via a Dependency link."
              />
            ) : null}
            {showTheyWait ? (
              <DirectionColumn
                title="A partner is waiting on us"
                subtitle="JIRA “blocks” — includes peer NDB teams; they often create only the link and skip ask labels (see hygiene above)"
                issues={theyWait}
                jiraBaseUrl={jiraBaseUrl}
                jiraUrl={sections.partnershipBlocks?.jiraUrl}
                jql={sections.partnershipBlocks?.jql}
                emptyHint="No partner is waiting on us via a Dependency link."
              />
            ) : null}
          </div>
        </details>
      ) : null}

      {showEarlyCalls && data && earlyCalls.length > 0 ? (
        <section className="dv-section dv-early" aria-label="Early calls on upcoming trains">
          <h2>Early calls — upcoming trains</h2>
          <p className="dv-col-sub">
            Releases where CC / EC (and often fixVersion) are not in play yet — e.g.{' '}
            <strong>NDB-3.1 ↔ Leto</strong>. These are label-based calls you are already making:
            train asks on partner tickets + wishlist on our NDB side. Not driven by{' '}
            {selectedRelease || 'current'} fixVersion links.
          </p>
          {earlyCalls.map((bundle) => {
            const s = bundle.sections || {};
            const askCount = bundle.trainAsks?.length ?? 0;
            const wlCount = bundle.wishlistItems?.length ?? 0;
            const unlinkedCount = bundle.wishlistUnlinkedItems?.length ?? 0;
            const orphanCount = bundle.orphanAsks?.length ?? 0;
            return (
              <details
                key={bundle.release}
                className="dv-early-bundle"
                open={show === 'early_calls' || askCount + wlCount > 0}
              >
                <summary>
                  <strong>
                    {bundle.release}
                    {bundle.train ? ` ↔ ${bundle.train}` : ''}
                  </strong>
                  {bundle.status ? (
                    <span className="dv-badge dv-badge--planned">{bundle.status}</span>
                  ) : null}
                  <span className="dv-meta">
                    {' '}
                    · ask labels {askCount} · wishlist {wlCount}
                    {unlinkedCount ? ` · wishlist unlinked ${unlinkedCount}` : ''}
                    {orphanCount ? ` · orphan asks ${orphanCount}` : ''}
                  </span>
                  {bundle.notes ? (
                    <span className="dv-meta"> — {bundle.notes}</span>
                  ) : null}
                </summary>
                {bundle.error ? (
                  <p className="dv-error">{bundle.error}</p>
                ) : (
                  <div className="dv-early-cols">
                    <div>
                      <h3>Ask labels on partner tickets</h3>
                      <p className="dv-col-sub">
                        {(bundle.trainAskLabels || []).join(', ') || `ndb-${bundle.trainSlug}-*`}
                      </p>
                      <Metric
                        section={{ ...s.trainLabels, count: askCount }}
                        label="Partner tickets with ask label"
                      />
                      <div className="dv-col-body">
                        {askCount === 0 ? (
                          <p className="dv-empty">No train ask labels yet for this release.</p>
                        ) : (
                          bundle.trainAsks.map((iss) => (
                            <TicketChip
                              key={iss.key}
                              issue={iss}
                              jiraBaseUrl={jiraBaseUrl}
                              showAskFlags={false}
                            />
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <h3>Wishlist into {bundle.release}</h3>
                      <p className="dv-col-sub">
                        {bundle.wishlistLabel || `ndb-${bundle.releaseSlug}-wishlist`} on our NDB
                        projects
                      </p>
                      <Metric
                        section={{ ...s.wishlist, count: wlCount }}
                        label="Wishlist projects"
                      />
                      {' · '}
                      <Metric
                        section={{ ...s.wishlistUnlinked, count: unlinkedCount }}
                        label="Wishlist with no link"
                      />
                      <div className="dv-col-body">
                        {wlCount === 0 ? (
                          <p className="dv-empty">No wishlist items for this release yet.</p>
                        ) : (
                          bundle.wishlistItems.map((iss) => (
                            <TicketChip
                              key={iss.key}
                              issue={iss}
                              jiraBaseUrl={jiraBaseUrl}
                              showAskFlags={false}
                            />
                          ))
                        )}
                      </div>
                    </div>
                    {orphanCount > 0 ? (
                      <div>
                        <h3>Orphan partner asks</h3>
                        <p className="dv-col-sub">
                          Train-dep label present but not linked to any {bundle.release} wishlist
                          item.
                        </p>
                        <Metric
                          section={{ ...s.partnerOrphans, count: orphanCount }}
                          label="Orphan asks"
                        />
                        <div className="dv-col-body">
                          {bundle.orphanAsks.map((iss) => (
                            <TicketChip
                              key={iss.key}
                              issue={iss}
                              jiraBaseUrl={jiraBaseUrl}
                              showAskFlags={false}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </details>
            );
          })}
        </section>
      ) : null}

      {showEarlyCalls && data && earlyCalls.length === 0 && show === 'early_calls' ? (
        <section className="dv-section dv-early">
          <h2>Early calls — upcoming trains</h2>
          <p className="dv-empty">
            No planned / later releases after {selectedRelease || 'this release'} in config.
          </p>
        </section>
      ) : null}

      {showWishlist && data ? (
        <section className="dv-section">
          <h2>Projects we wish into this NDB release</h2>
          <p className="dv-col-sub">
            Wishlist labels live on <strong>our</strong> NDB projects — “I wish this project lands
            in {selectedRelease || 'this release'}.”
          </p>
          <details open={show === 'wishlist'}>
            <summary>
              <Metric
                section={{ ...sections.wishlist, count: wishlist.length }}
                label="Wishlist projects"
              />
              {' · '}
              <Metric
                section={{ ...sections.wishlistUnlinked, count: wishlistUnlinked.length }}
                label="Wishlist with no link yet"
              />
            </summary>
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
          </details>
        </section>
      ) : null}

      {showTrain && data ? (
        <section className="dv-section">
          <h2>
            Asks we labeled on partner tickets
            {train.train ? ` (for ${train.train})` : ''}
          </h2>
          <p className="dv-col-sub">
            Labels sit on the <strong>partner’s</strong> ticket (peer NDB or outside NDB) so the ask
            for the train is visible — not the same as a wishlist on our NDB project.
          </p>
          <details open={show === 'train_asks'}>
            <summary>
              <Metric
                section={{ ...sections.trainLabels, count: trainAsks.length }}
                label="Partner tickets with an ask label"
              />
            </summary>
            <div className="dv-col-body">
              {trainAsks.length === 0 ? (
                <p className="dv-empty">
                  No ask labels found on partner tickets for this train.
                </p>
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
          </details>
        </section>
      ) : null}

      {showPartnership && data ? (
        <section className="dv-section">
          <h2>Shared project delivery (Partnership)</h2>
          <p className="dv-col-sub">
            Multiple teams delivering as one project under a FEAT / Initiative → Epic hierarchy —
            not a blocks/blocked-by Dependency link.
          </p>
          {!companions.length ? (
            <p className="dv-empty">
              No shared-project roots are configured for this release yet.
            </p>
          ) : (
            companions.map((c) => (
              <details key={c.rootKey} open={show === 'partnership'}>
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
      ) : null}

      {!data && loading ? <p className="dv-empty">Loading…</p> : null}
    </div>
  );
}
