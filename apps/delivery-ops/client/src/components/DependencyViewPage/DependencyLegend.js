import React from 'react';

/**
 * Always-visible key: what each lane / chip / Gantt mark means in plain language.
 */
export default function DependencyLegend({ variant = 'swimlane' }) {
  if (variant === 'gantt') {
    return (
      <div className="dv-key dv-key--gantt" aria-label="Gantt key">
        <div className="dv-key-title">How to read the Gantt</div>
        <ul className="dv-key-list">
          <li>
            <span className="dv-key-mark" aria-hidden="true">
              ▬
            </span>
            <span>
              <strong>Bar width = calendar days</strong> from start → end on the time axis. Longer ≠
              more important; it only means a longer date span.
            </span>
          </li>
          <li>
            <span className="dv-key-swatch dv-tone-wishlist" aria-hidden="true" />
            <span>
              <strong>Bar color</strong> — role (wishlist / partner / upstream / downstream), same as
              swimlanes.
            </span>
          </li>
          <li>
            <span className="dv-key-mark" aria-hidden="true">
              ↳
            </span>
            <span>
              <strong>Left column</strong> — full ticket key + day count (always legible). Short bars
              also show <code>KEY · N days</code> beside the stub.
            </span>
          </li>
          <li>
            <span className="dv-key-diamond" aria-hidden="true" />
            <span>
              <strong>Diamond</strong> — milestone (single date, not a range).
            </span>
          </li>
          <li>
            <span className="dv-key-mark" aria-hidden="true">
              —
            </span>
            <span>
              <strong>Clone / Duplicate</strong> links are ignored — not drawn as dependency arrows.
            </span>
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className="dv-key" aria-label="Dependency key">
      <div className="dv-key-title">What the colors mean</div>
      <ul className="dv-key-list">
        <li>
          <span className="dv-key-swatch dv-tone-wishlist" aria-hidden="true" />
          <span>
            <strong>Wishlist</strong> — NDB pre-commit ask that already has a real JIRA link to a
            partner (not just a label).
          </span>
        </li>
        <li>
          <span className="dv-key-swatch dv-tone-partner" aria-hidden="true" />
          <span>
            <strong>Partner</strong> — partner-team ticket linked from a wishlist item; chase{' '}
            <em>Ask</em> until committed.
          </span>
        </li>
        <li>
          <span className="dv-key-swatch dv-tone-warn" aria-hidden="true" />
          <span>
            <strong>Label-only / Clone-only</strong> — has the wishlist label, but no useful issue
            link (none, or only Clone/Duplicate). Not a tracked dependency until linked.
          </span>
        </li>
        <li>
          <span className="dv-key-swatch dv-tone-orphan" aria-hidden="true" />
          <span>
            <strong>Orphan</strong> — has a train-dep / asks label, but is not linked to any wishlist
            item. Link it or drop the label.
          </span>
        </li>
        <li>
          <span className="dv-key-chip-demo ask" aria-hidden="true">
            Ask
          </span>
          <span>
            <strong>Ask</strong> — not committed (no real fixVersion / Release Commit field).
            Commit column also shows <em>via fixVersion</em> vs <em>via Release Commit field</em> and
            the JIRA link type name (e.g. blocks).
          </span>
        </li>
        <li>
          <span className="dv-key-chip-demo committed" aria-hidden="true">
            Ok
          </span>
          <span>
            <strong>Ok</strong> on a chip — partner (or NDB) has committed the work.
          </span>
        </li>
        <li>
          <span
            className="dv-span-badge dv-span-badge--ndb_ew"
            aria-hidden="true"
            style={{ marginRight: 4 }}
          >
            NDB
          </span>
          <span>
            <strong>Partner type</strong> — EW only (
            <code>global-ew</code> / <code>nutanix-ew</code> / <code>ndb-ew</code> / team). Not
            train labels. Use <strong>Show</strong> for partnership / labeled asks / wishlist.
          </span>
        </li>
      </ul>
    </div>
  );
}
