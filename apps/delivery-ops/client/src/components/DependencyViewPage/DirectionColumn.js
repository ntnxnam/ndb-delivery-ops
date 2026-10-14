import React from 'react';
import TicketChip from './TicketChip';

const EW_BUCKETS = [
  { id: 'global_ew', title: 'Global EW', hint: 'global-ew' },
  { id: 'nutanix_ew', title: 'Nutanix EW', hint: 'nutanix-ew' },
  { id: 'ndb_ew', title: 'Peer NDB', hint: 'ndb-ew' },
];

function spanIdOf(iss) {
  return String(iss?.spanInfo?.id || iss?.span || 'team_internal');
}

/**
 * One direction column: I wait | They wait — subdivided by EW project type.
 */
export default function DirectionColumn({
  title,
  subtitle,
  issues,
  jiraBaseUrl,
  jiraUrl,
  jql,
  emptyHint,
}) {
  const list = issues || [];
  const byBucket = EW_BUCKETS.map((b) => ({
    ...b,
    issues: list.filter((i) => spanIdOf(i) === b.id),
  }));
  const fyi = list.filter((i) => !EW_BUCKETS.some((b) => b.id === spanIdOf(i)));

  return (
    <section className="dv-col" aria-label={title}>
      <header className="dv-col-head">
        <h3>{title}</h3>
        {subtitle ? <p className="dv-col-sub">{subtitle}</p> : null}
        <div className="dv-col-count">
          {jiraUrl ? (
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer" title={jql || ''}>
              {list.length}
            </a>
          ) : (
            list.length
          )}
        </div>
      </header>
      <div className="dv-col-body">
        {!list.length ? (
          <p className="dv-empty">{emptyHint || 'None.'}</p>
        ) : (
          <>
            {byBucket.map((bucket) => (
              <div key={bucket.id} className={`dv-ew-bucket dv-ew-bucket--${bucket.id}`}>
                <div className="dv-ew-bucket-head">
                  <span className="dv-ew-bucket-title">{bucket.title}</span>
                  <span className="dv-ew-bucket-count">{bucket.issues.length}</span>
                  <span className="dv-ew-bucket-hint">{bucket.hint}</span>
                </div>
                {bucket.issues.length === 0 ? (
                  <p className="dv-empty">None</p>
                ) : (
                  bucket.issues.map((iss) => (
                    <TicketChip key={iss.key} issue={iss} jiraBaseUrl={jiraBaseUrl} />
                  ))
                )}
              </div>
            ))}
            {fyi.length > 0 ? (
              <details className="dv-fyi">
                <summary>
                  Same squad / could not park by EW (FYI) — {fyi.length}
                </summary>
                {fyi.map((iss) => (
                  <TicketChip key={iss.key} issue={iss} jiraBaseUrl={jiraBaseUrl} />
                ))}
              </details>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
