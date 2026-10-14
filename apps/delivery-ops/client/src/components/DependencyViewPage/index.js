import React, { useEffect, useMemo, useState } from 'react';
import { useDependencyView } from '../../hooks/useDependencyView';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import WishlistSettingsBar from './WishlistSettingsBar';
import DependencyVisualMap from './DependencyVisualMap';
import CollapsibleIssueSection from './CollapsibleIssueSection';
import { filterLabelOnlyWishlist, filterRelatedWishlist } from './wishlistRelated';
import { PAGE_OUTCOME, SHOW_CAPTIONS, SHOW_OPTIONS } from './modeHelp';
import { buildNextActions } from './nextActions';
import './DependencyView.css';

function NumLink({ section, label }) {
  if (!section) return null;
  const count = section.count ?? 0;
  const href = section.jiraUrl;
  if (!href) {
    return (
      <div className="dv-metric">
        <span className="n">{count}</span>
        <span className="l">{label}</span>
      </div>
    );
  }
  return (
    <a
      className="dv-metric"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={section.jql || ''}
      aria-label={`${label}: ${count} — open in JIRA`}
    >
      <span className="n">{count}</span>
      <span className="l">{label}</span>
    </a>
  );
}

function gateLines(ndbGates) {
  if (!ndbGates || typeof ndbGates !== 'object') return [];
  const lines = [];
  if (ndbGates.ecDate) lines.push(`EC: ${ndbGates.ecDate}`);
  ['ccm1Gate', 'ccm2Gate', 'commitGate1', 'commitGate2', 'promotionGate1', 'promotionGate2', 'ga1', 'ga2'].forEach(
    (k) => {
      const g = ndbGates[k];
      if (g && (g.date || g.label)) {
        lines.push(`${g.label || k}: ${g.date || '—'}`);
      }
    }
  );
  if (ndbGates.gaDate) lines.push(`GA: ${ndbGates.gaDate}`);
  return lines;
}

function issueSpanId(iss) {
  if (iss?.spanInfo?.id != null) return String(iss.spanInfo.id);
  if (iss?.span != null) return String(iss.span);
  return 'team_internal';
}

/** Partner type = *-ew only. Section visibility comes from Show, not from issue.source here. */
function filterIssues(issues, { partnerType }) {
  return (issues || []).filter((iss) => {
    if (partnerType !== 'all' && issueSpanId(iss) !== String(partnerType)) return false;
    return true;
  });
}

/**
 * Map Show → which sections / directions are visible.
 * @param {string} show
 */
function visibilityForShow(show) {
  switch (show) {
    case 'i_wait':
      return {
        showPartnership: true,
        showCompanion: false,
        showLabels: false,
        showWishlist: false,
        showIWait: true,
        showTheyWait: false,
      };
    case 'they_wait':
      return {
        showPartnership: true,
        showCompanion: false,
        showLabels: false,
        showWishlist: false,
        showIWait: false,
        showTheyWait: true,
      };
    case 'train_labels':
      return {
        showPartnership: false,
        showCompanion: false,
        showLabels: true,
        showWishlist: false,
        showIWait: false,
        showTheyWait: false,
      };
    case 'wishlist':
      return {
        showPartnership: false,
        showCompanion: false,
        showLabels: false,
        showWishlist: true,
        showIWait: false,
        showTheyWait: false,
      };
    case 'companion':
      return {
        showPartnership: false,
        showCompanion: true,
        showLabels: false,
        showWishlist: false,
        showIWait: false,
        showTheyWait: false,
      };
    case 'everything':
    default:
      return {
        showPartnership: true,
        showCompanion: true,
        showLabels: true,
        showWishlist: true,
        showIWait: true,
        showTheyWait: true,
      };
  }
}

export default function DependencyViewPage() {
  const { selectedTeamId, selectedTeam, hasTeamSelected } = useTeam();
  const [release, setRelease] = useState('');
  const [show, setShow] = useState('everything');
  const [partnerType, setPartnerType] = useState('all');

  const {
    data,
    loading,
    refreshing,
    error,
    refresh,
    saveWishlistConfig,
    savingConfig,
    configSaveError,
  } = useDependencyView(selectedTeamId, release || undefined);

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
  const sections = data?.sections || {};
  const selectedRelease = release || data?.release || '';
  const dataMatchesRelease =
    !selectedRelease || !data?.release || data.release === selectedRelease;
  const fetchingRelease =
    Boolean(loading || refreshing) ||
    Boolean(selectedRelease && data?.release && data.release !== selectedRelease);

  const filterOpts = useMemo(() => ({ partnerType }), [partnerType]);

  const filteredPartnershipBlockedBy = useMemo(
    () => filterIssues(sections.partnershipBlockedBy?.issues, filterOpts),
    [sections.partnershipBlockedBy, filterOpts]
  );
  const filteredPartnershipBlocks = useMemo(
    () => filterIssues(sections.partnershipBlocks?.issues, filterOpts),
    [sections.partnershipBlocks, filterOpts]
  );
  const filteredLabels = useMemo(
    () => filterIssues(sections.trainLabels?.issues, filterOpts),
    [sections.trainLabels, filterOpts]
  );
  const filteredWishlistAll = useMemo(
    () => filterIssues(sections.wishlist?.issues, filterOpts),
    [sections.wishlist, filterOpts]
  );
  const filteredWishlistLinked = useMemo(
    () => filterIssues(sections.wishlistLinked?.issues, filterOpts),
    [sections.wishlistLinked, filterOpts]
  );
  const filteredWishlistUnlinked = useMemo(
    () => filterIssues(sections.wishlistUnlinked?.issues, filterOpts),
    [sections.wishlistUnlinked, filterOpts]
  );
  const ignoredLinkPatterns = useMemo(
    () =>
      Array.isArray(data?.wishlistMeta?.ignoredLinkTypePatterns) &&
      data.wishlistMeta.ignoredLinkTypePatterns.length
        ? data.wishlistMeta.ignoredLinkTypePatterns
        : ['clone', 'cloner', 'duplicat'],
    [data?.wishlistMeta?.ignoredLinkTypePatterns]
  );

  const filteredWishlist = useMemo(
    () =>
      filterRelatedWishlist(
        filteredWishlistAll,
        filteredWishlistUnlinked,
        ignoredLinkPatterns
      ),
    [filteredWishlistAll, filteredWishlistUnlinked, ignoredLinkPatterns]
  );

  const filteredWishlistLabelOnly = useMemo(
    () =>
      filterLabelOnlyWishlist(
        filteredWishlistAll,
        filteredWishlistUnlinked,
        ignoredLinkPatterns
      ),
    [filteredWishlistAll, filteredWishlistUnlinked, ignoredLinkPatterns]
  );
  const filteredPartnerOrphans = useMemo(
    () => filterIssues(sections.partnerOrphans?.issues, filterOpts),
    [sections.partnerOrphans, filterOpts]
  );

  const {
    showPartnership,
    showCompanion,
    showLabels,
    showWishlist,
    showIWait,
    showTheyWait,
  } = visibilityForShow(show);

  const wlMeta = data?.wishlistMeta || {};
  const showCaption = SHOW_CAPTIONS[show] || SHOW_CAPTIONS.everything;

  const nextActions = useMemo(
    () =>
      buildNextActions({
        partnershipBlockedBy: filteredPartnershipBlockedBy,
        partnershipBlocks: filteredPartnershipBlocks,
        wishlist: filteredWishlist,
        wishlistLinked: filteredWishlistLinked,
        wishlistLabelOnly: filteredWishlistLabelOnly,
        partnerOrphans: filteredPartnerOrphans,
      }),
    [
      filteredPartnershipBlockedBy,
      filteredPartnershipBlocks,
      filteredWishlist,
      filteredWishlistLinked,
      filteredWishlistLabelOnly,
      filteredPartnerOrphans,
    ]
  );

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Select a team for Dependency View"
        description="Dependency View is NDB-first; pick a team in the sidebar, then Fetch."
      />
    );
  }

  return (
    <div className="dv-page">
      <div className="dv-header">
        <h2>Dependency View</h2>
        <span className="dv-badge">Read-only</span>
        <span className="dv-meta">
          {selectedTeam?.name || selectedTeamId || '—'}
          {data?.asOf ? ` · as of ${new Date(data.asOf).toLocaleString()}` : ''}
        </span>
        <div className="dv-actions">
          <button type="button" onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? 'Pulling…' : 'Pull from JIRA'}
          </button>
        </div>
      </div>

      <p className="dv-outcome">{PAGE_OUTCOME}</p>

      <WishlistSettingsBar
        wishlistMeta={wlMeta}
        onSave={saveWishlistConfig}
        saving={savingConfig}
        saveError={configSaveError}
        disabled={loading && !data}
      />

      <div className="dv-filters">
        <label>
          Release
          <select
            value={selectedRelease}
            onChange={(e) => setRelease(e.target.value)}
            disabled={fetchingRelease && !data}
          >
            {(releases.length ? releases : [selectedRelease || 'NDB-3.0']).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="dv-fetch-btn"
          onClick={refresh}
          disabled={!selectedTeamId || fetchingRelease}
          title="Fetch Dependency Gantt and tables for the selected release"
        >
          {fetchingRelease ? 'Fetching…' : 'Fetch'}
        </button>
        <label className="dv-filter-show" title="What do you want to look at?">
          Show
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            {SHOW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label title="Partner EW type from *-ew labels only — not train-dep / asks / wishlist">
          Partner type
          <select value={partnerType} onChange={(e) => setPartnerType(e.target.value)}>
            <option value="all">Any</option>
            {(data?.spans || []).map((s) => (
              <option key={s.id} value={String(s.id)} title={s.hint || ''}>
                {s.jiraLabel ? s.label : `${s.label} (no *-ew)`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="dv-show-caption" role="note">
        {showCaption}
      </p>

      {error && <div className="dv-error">{error}</div>}
      {loading && !data && <div className="dv-meta">Loading dependency overview…</div>}
      {fetchingRelease && selectedRelease && !dataMatchesRelease && (
        <div className="dv-meta dv-fetching-banner">
          Fetching {selectedRelease} from JIRA — swimlanes update when ready.
        </div>
      )}
      {!fetchingRelease && error && data && !dataMatchesRelease && (
        <div className="dv-meta dv-fetching-banner">
          Could not load {selectedRelease}. Showing last successful load ({data.release}).
          Use <strong>Fetch</strong> to retry.
        </div>
      )}

      {data && (dataMatchesRelease || (!fetchingRelease && error)) && (
        <>
          <div className="dv-next-actions">
            <h3>Next actions</h3>
            <ul>
              {nextActions.map((a) => (
                <li key={a.id} className={`dv-next-actions--${a.severity}`}>
                  {a.text}
                </li>
              ))}
            </ul>
          </div>

          <details className="dv-collapse dv-train-collapse">
            <summary className="dv-collapse-summary">
              <span className="dv-collapse-title">
                Gates & aligned train{train.train ? ` · ${train.train}` : ''}
              </span>
              {train.status ? (
                <span className={`dv-train-status ${train.status}`}>{train.status}</span>
              ) : null}
              <span className="dv-collapse-hint">Expand</span>
            </summary>
            <div className="dv-collapse-body">
              <div className="dv-train">
                <div>
                  <h3>NDB gates — {data.release}</h3>
                  <ul>
                    {gateLines(data.ndbGates).length ? (
                      gateLines(data.ndbGates).map((line) => <li key={line}>{line}</li>)
                    ) : (
                      <li>No gate dates in release config</li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3>Aligned train{train.train ? `: ${train.train}` : ''}</h3>
                  <ul>
                    {train.notes ? <li>{train.notes}</li> : null}
                    {train.trainSlug ? (
                      <li>Label slug: ndb-{train.trainSlug}-dependency / -asks</li>
                    ) : null}
                    {(train.partnerVersions || []).length ? (
                      <li>Partner versions: {train.partnerVersions.join(', ')}</li>
                    ) : (
                      <li>Partner versions: (configure in dependencyViewConfig)</li>
                    )}
                    {train.confluenceUrl ? (
                      <li>
                        <a href={train.confluenceUrl} target="_blank" rel="noopener noreferrer">
                          Confluence SoT
                        </a>
                      </li>
                    ) : (
                      <li>Confluence SoT: not set</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </details>

          <div className="dv-metrics">
            {showPartnership && showIWait && (
              <NumLink section={sections.partnershipBlockedBy} label="I wait on them" />
            )}
            {showPartnership && showTheyWait && (
              <NumLink section={sections.partnershipBlocks} label="They wait on me" />
            )}
            {showLabels && <NumLink section={sections.trainLabels} label="Train labels" />}
            {showWishlist && (
              <>
                <NumLink
                  section={{
                    ...sections.wishlist,
                    count: filteredWishlist.length,
                    issues: filteredWishlist,
                  }}
                  label="Wishlist (linked)"
                />
                <NumLink section={sections.wishlistLinked} label="Partners" />
                <NumLink
                  section={{
                    ...sections.wishlistUnlinked,
                    count: filteredWishlistLabelOnly.length,
                    issues: filteredWishlistLabelOnly,
                  }}
                  label="Label-only / Clone-only"
                />
                <NumLink section={sections.partnerOrphans} label="Partner orphans" />
              </>
            )}
            {showCompanion &&
              (sections.companions || []).map((c) => (
                <NumLink
                  key={`${c.rootKey}-ext`}
                  section={c.external}
                  label={`External · ${c.rootKey}`}
                />
              ))}
          </div>

          <DependencyVisualMap
            sections={sections}
            wishlistMeta={wlMeta}
            jiraBaseUrl={jiraBaseUrl}
            ndbGates={data.ndbGates}
            release={data.release}
            showWishlist={showWishlist}
            showPartnership={showPartnership}
            showIWait={showIWait}
            showTheyWait={showTheyWait}
            filtered={{
              wishlist: filteredWishlist,
              wishlistUnlinked: filteredWishlistUnlinked,
              wishlistLinked: filteredWishlistLinked,
              partnerOrphans: filteredPartnerOrphans,
              partnershipBlockedBy: filteredPartnershipBlockedBy,
              partnershipBlocks: filteredPartnershipBlocks,
            }}
          />

          <section className="dv-section dv-ticket-lists">
            <h3>
              Ticket lists{' '}
              <span className="dv-meta">collapsed by default · expand only to drill in</span>
            </h3>

            {showPartnership && showIWait && (
              <CollapsibleIssueSection
                title="Partnership — I wait on them"
                count={filteredPartnershipBlockedBy.length}
                jiraUrl={sections.partnershipBlockedBy?.jiraUrl}
                jql={sections.partnershipBlockedBy?.jql}
                issues={filteredPartnershipBlockedBy}
                jiraBaseUrl={jiraBaseUrl}
                variant="i_wait_on_them"
                meta={'· “My [ticket] is waiting on that ticket”'}
              />
            )}

            {showPartnership && showTheyWait && (
              <CollapsibleIssueSection
                title="Partnership — They wait on me"
                count={filteredPartnershipBlocks.length}
                jiraUrl={sections.partnershipBlocks?.jiraUrl}
                jql={sections.partnershipBlocks?.jql}
                issues={filteredPartnershipBlocks}
                jiraBaseUrl={jiraBaseUrl}
                variant="they_wait_on_me"
                meta={'· “Their [ticket] is waiting on my [ticket]”'}
              />
            )}

            {showLabels && (
              <CollapsibleIssueSection
                title="Train labels (on our tickets)"
                count={filteredLabels.length}
                jiraUrl={sections.trainLabels?.jiraUrl}
                jql={sections.trainLabels?.jql}
                issues={filteredLabels}
                jiraBaseUrl={jiraBaseUrl}
                meta="· ndb-*-dependency / -asks — not Partner type (*-ew)"
              />
            )}

            {showWishlist && (
              <>
                <CollapsibleIssueSection
                  title="Wishlist with links"
                  count={filteredWishlist.length}
                  jiraUrl={sections.wishlist?.jiraUrl}
                  jql={sections.wishlist?.jql}
                  issues={filteredWishlist}
                  jiraBaseUrl={jiraBaseUrl}
                  meta={
                    wlMeta.wishlistLabel
                      ? `· ${wlMeta.wishlistLabel}${
                          (wlMeta.partnerLabels || []).length
                            ? ` ↔ ${(wlMeta.partnerLabels || []).join(', ')}`
                            : ''
                        } · Clone/Duplicate ignored`
                      : '· Clone/Duplicate ignored'
                  }
                />
                <CollapsibleIssueSection
                  title="Partners (linked from wishlist)"
                  count={filteredWishlistLinked.length}
                  jiraUrl={sections.wishlistLinked?.jiraUrl}
                  jql={sections.wishlistLinked?.jql}
                  issues={filteredWishlistLinked}
                  jiraBaseUrl={jiraBaseUrl}
                />
                <CollapsibleIssueSection
                  title="Label-only / Clone-only"
                  count={filteredWishlistLabelOnly.length}
                  jiraUrl={sections.wishlistUnlinked?.jiraUrl}
                  jql={sections.wishlistUnlinked?.jql}
                  issues={filteredWishlistLabelOnly}
                  jiraBaseUrl={jiraBaseUrl}
                />
                <CollapsibleIssueSection
                  title="Partner orphans (train-dep, no wishlist link)"
                  count={filteredPartnerOrphans.length}
                  jiraUrl={sections.partnerOrphans?.jiraUrl}
                  jql={sections.partnerOrphans?.jql}
                  issues={filteredPartnerOrphans}
                  jiraBaseUrl={jiraBaseUrl}
                />
              </>
            )}

            {showCompanion &&
              (sections.companions || []).map((c) => {
                const companionIssues = filterIssues(c.external?.issues, filterOpts);
                return (
                  <CollapsibleIssueSection
                    key={c.rootKey}
                    title={`Companion external — ${c.label || c.rootKey}`}
                    count={companionIssues.length}
                    jiraUrl={c.external?.jiraUrl}
                    jql={c.external?.jql}
                    issues={companionIssues}
                    jiraBaseUrl={jiraBaseUrl}
                  />
                );
              })}
          </section>
        </>
      )}
    </div>
  );
}
