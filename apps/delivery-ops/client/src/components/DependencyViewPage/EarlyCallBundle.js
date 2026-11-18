import React, { useMemo } from 'react';
import DependencySwimlanes from './DependencySwimlanes';
import TicketChip from './TicketChip';

const EMPTY_ISSUES = [];

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

/**
 * One planned train early-call: story first (wishlist → waits on → partner asks),
 * then missing-arrow hygiene (unlinked wishlist / orphan asks).
 */
export default function EarlyCallBundle({
  bundle,
  jiraBaseUrl,
  defaultOpen = false,
}) {
  const s = bundle.sections || {};
  const trainAsks = bundle.trainAsks || EMPTY_ISSUES;
  const wishlistItems = bundle.wishlistItems || EMPTY_ISSUES;
  const unlinkedItems = bundle.wishlistUnlinkedItems || EMPTY_ISSUES;
  const orphanAsks = bundle.orphanAsks || EMPTY_ISSUES;

  const askCount = trainAsks.length;
  const wlCount = wishlistItems.length;
  const unlinkedCount = unlinkedItems.length;
  const orphanCount = orphanAsks.length;

  const { linkedAsks, linkedWishlist } = useMemo(() => {
    const orphanKeys = new Set(orphanAsks.map((iss) => iss.key).filter(Boolean));
    const unlinkedKeys = new Set(unlinkedItems.map((iss) => iss.key).filter(Boolean));
    return {
      linkedAsks: trainAsks.filter((iss) => iss?.key && !orphanKeys.has(iss.key)),
      linkedWishlist: wishlistItems.filter((iss) => iss?.key && !unlinkedKeys.has(iss.key)),
    };
  }, [trainAsks, wishlistItems, unlinkedItems, orphanAsks]);

  const hasLinkedChains = linkedAsks.length > 0 || linkedWishlist.length > 0;
  const hasAny = askCount > 0 || wlCount > 0;

  const trainLabel = bundle.displayName || bundle.train || 'partner train';
  const statusLabel = bundle.statusLabel || bundle.status || null;

  const story = useMemo(() => {
    const release = bundle.release || 'this NDB release';
    return (
      <>
        Early calls are label-based (pre-CC/EC). Read left → right:{' '}
        <strong>our wishlist into {release}</strong>
        <span className="dv-edge-arrow-line"> → waits on → </span>
        <strong>partner asks on {trainLabel}</strong>
        {linkedWishlist.length || linkedAsks.length
          ? ` — ${linkedWishlist.length} linked wishlist · ${linkedAsks.length} linked asks`
          : ' — no Mode Dependency links yet; see Missing arrows below'}
        .
      </>
    );
  }, [bundle.release, trainLabel, linkedWishlist.length, linkedAsks.length]);

  return (
    <details className="dv-early-bundle" open={defaultOpen || hasAny}>
      <summary className="dv-early-summary">
        <span
          className="dv-early-pair"
          aria-label={`${bundle.release} asks ${trainLabel}`}
        >
          <span className="dv-early-pair-us">{bundle.release}</span>
          <span className="dv-early-pair-arrow" aria-hidden="true">
            <span className="dv-early-pair-arrow-label">asks</span>
            <span className="dv-early-pair-arrow-line">→</span>
          </span>
          <span className="dv-early-pair-them">{trainLabel}</span>
        </span>
        {statusLabel ? (
          <span className="dv-badge dv-badge--planned">{statusLabel}</span>
        ) : null}
        <span className="dv-meta">
          {' '}
          · ask labels {askCount} · wishlist {wlCount}
          {unlinkedCount ? ` · wishlist unlinked ${unlinkedCount}` : ''}
          {orphanCount ? ` · orphan asks ${orphanCount}` : ''}
        </span>
        {bundle.notes ? <span className="dv-meta"> — {bundle.notes}</span> : null}
      </summary>

      {bundle.error ? (
        <p className="dv-error">{bundle.error}</p>
      ) : (
        <>
          <div className="dv-early-flow" aria-hidden="true">
            <span className="dv-early-pair-us">Our wishlist</span>
            <span className="dv-early-pair-arrow">
              <span className="dv-early-pair-arrow-label">waits on</span>
              <span className="dv-early-pair-arrow-line">→</span>
            </span>
            <span className="dv-early-pair-them">Partner asks ({trainLabel})</span>
          </div>
          {bundle.askLabelHint ? (
            <p className="dv-col-sub">
              Ask labels: <code className="dv-code">{bundle.askLabelHint}</code>
              {bundle.wishlistLabel ? (
                <>
                  {' '}
                  · Wishlist: <code className="dv-code">{bundle.wishlistLabel}</code>
                </>
              ) : null}
            </p>
          ) : null}

          {hasLinkedChains ? (
            <DependencySwimlanes
              iWaitIssues={linkedAsks}
              theyWaitIssues={[]}
              projectIssues={linkedWishlist}
              chainExtras={[]}
              jiraBaseUrl={jiraBaseUrl}
              iWaitJiraUrl={s.trainLabels?.jiraUrl}
              iWaitJql={s.trainLabels?.jql}
              showIWait
              showTheyWait={false}
              title={`${bundle.release} → waits on → ${trainLabel}`}
              story={story}
              weWaitHeading="Wishlist → waits on → partner ask"
              legend={
                <>
                  <strong>Our wishlist</strong>
                  <span className="dv-edge-arrow-line">→ waits on →</span>
                  <strong>Their ask</strong>
                </>
              }
              sectionClassName="dv-early-swim"
            />
          ) : (
            <p className="dv-empty">
              No linked wishlist → partner chains yet for {bundle.release} ↔ {trainLabel}. Labels
              exist; Mode Dependency arrows are still missing.
            </p>
          )}

          {unlinkedCount > 0 || orphanCount > 0 ? (
            <div className="dv-early-hygiene" aria-label="Missing dependency links">
              <h3>Missing arrows (no Mode Dependency link yet)</h3>
              <p className="dv-col-sub">
                Labels without a JIRA blocks/blocked-by link — chase to complete the happy path.
              </p>
              <div className="dv-early-hygiene-cols">
                {unlinkedCount > 0 ? (
                  <div>
                    <h4>Wishlist with no link</h4>
                    <Metric
                      section={{ ...s.wishlistUnlinked, count: unlinkedCount }}
                      label="Unlinked wishlist"
                    />
                    <div className="dv-col-body">
                      {unlinkedItems.map((iss) => (
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
                {orphanCount > 0 ? (
                  <div>
                    <h4>Orphan partner asks</h4>
                    <p className="dv-col-sub">
                      Train-dep label present but not linked to any {bundle.release} wishlist item.
                    </p>
                    <Metric
                      section={{ ...s.partnerOrphans, count: orphanCount }}
                      label="Orphan asks"
                    />
                    <div className="dv-col-body">
                      {orphanAsks.map((iss) => (
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
            </div>
          ) : null}
        </>
      )}
    </details>
  );
}
