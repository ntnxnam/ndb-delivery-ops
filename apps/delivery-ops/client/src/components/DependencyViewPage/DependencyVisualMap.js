import React, { useMemo } from 'react';
import DependencyGantt from './DependencyGantt';
import DependencySwimlanes from './DependencySwimlanes';
import DependencyLegend from './DependencyLegend';
import { filterRelatedWishlist } from './wishlistRelated';

const DEFAULT_IGNORED = ['clone', 'cloner', 'duplicat'];

/**
 * Primary visual: swimlane flowchart. Gantt is secondary (collapsed by default).
 */
export default function DependencyVisualMap({
  sections,
  wishlistMeta,
  jiraBaseUrl,
  ndbGates,
  release,
  showWishlist,
  showPartnership,
  showIWait,
  showTheyWait,
  filtered,
}) {
  const wl = useMemo(() => filtered?.wishlist || [], [filtered?.wishlist]);
  const wlUnlinked = useMemo(() => filtered?.wishlistUnlinked || [], [filtered?.wishlistUnlinked]);
  const wlLinkedPartners = useMemo(
    () => filtered?.wishlistLinked || [],
    [filtered?.wishlistLinked]
  );
  const orphans = useMemo(() => filtered?.partnerOrphans || [], [filtered?.partnerOrphans]);
  const blockedBy = useMemo(
    () => filtered?.partnershipBlockedBy || [],
    [filtered?.partnershipBlockedBy]
  );
  const blocks = useMemo(
    () => filtered?.partnershipBlocks || [],
    [filtered?.partnershipBlocks]
  );

  const ganttFiltered = useMemo(() => {
    const out = {};
    if (showWishlist) {
      out.wishlist = wl;
      out.wishlistUnlinked = wlUnlinked;
      out.wishlistLinked = wlLinkedPartners;
      out.partnerOrphans = orphans;
    }
    if (showPartnership) {
      if (showIWait) out.partnershipBlockedBy = blockedBy;
      if (showTheyWait) out.partnershipBlocks = blocks;
    }
    return out;
  }, [
    showWishlist,
    showPartnership,
    showIWait,
    showTheyWait,
    wl,
    wlUnlinked,
    wlLinkedPartners,
    orphans,
    blockedBy,
    blocks,
  ]);

  const ignoredPatterns = useMemo(
    () =>
      Array.isArray(wishlistMeta?.ignoredLinkTypePatterns) &&
      wishlistMeta.ignoredLinkTypePatterns.length
        ? wishlistMeta.ignoredLinkTypePatterns
        : DEFAULT_IGNORED,
    [wishlistMeta?.ignoredLinkTypePatterns]
  );

  const relatedWl = useMemo(
    () => filterRelatedWishlist(wl, wlUnlinked, ignoredPatterns),
    [wl, wlUnlinked, ignoredPatterns]
  );

  const hasWishlistViz =
    showWishlist && (relatedWl.length || wlLinkedPartners.length || wlUnlinked.length || orphans.length);
  const hasPartnershipViz =
    showPartnership && ((showIWait && blockedBy.length) || (showTheyWait && blocks.length));
  const hasAny = hasWishlistViz || hasPartnershipViz || showPartnership || showWishlist;

  if (!hasAny) {
    return (
      <section className="dv-visual" aria-label="Dependency visual map">
        <h3>Swimlane map</h3>
        <div className="dv-empty">No issues to map for the current filters.</div>
      </section>
    );
  }

  return (
    <section className="dv-visual" aria-label="Dependency visual map">
      <h3>
        Swimlane map{' '}
        <span className="dv-meta">
          chips open JIRA
          {wishlistMeta?.wishlistLabel ? ` · ${wishlistMeta.wishlistLabel}` : ''}
        </span>
      </h3>

      <DependencyLegend variant="swimlane" />

      <DependencySwimlanes
        jiraBaseUrl={jiraBaseUrl}
        sections={sections}
        showWishlist={showWishlist}
        showPartnership={showPartnership}
        showIWait={showIWait}
        showTheyWait={showTheyWait}
        filtered={{
          wishlist: relatedWl,
          wishlistLinked: wlLinkedPartners,
          wishlistUnlinked: wlUnlinked,
          partnerOrphans: orphans,
          partnershipBlockedBy: blockedBy,
          partnershipBlocks: blocks,
        }}
      />

      <details className="dv-collapse dv-gantt-collapse">
        <summary className="dv-collapse-summary">
          <span className="dv-collapse-title">Timeline Gantt</span>
          <span className="dv-meta">optional · dated bars + link arrows</span>
          <span className="dv-collapse-hint">Expand</span>
        </summary>
        <div className="dv-collapse-body">
          <DependencyLegend variant="gantt" />
          <DependencyGantt
            filtered={ganttFiltered}
            ndbGates={ndbGates}
            jiraBaseUrl={jiraBaseUrl}
            release={release}
            ignoredLinkTypePatterns={ignoredPatterns}
          />
        </div>
      </details>
    </section>
  );
}
