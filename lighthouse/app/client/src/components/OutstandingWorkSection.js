/**
 * Release Outstanding Work — post-PG buckets + exec report send.
 * Headline (Dev open · Must-fix) + Dev / Test / KPI hero panels
 * vs hygiene strip (cleanup, not capacity).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { jiraSearchUrl } from '../release/services/releaseBriefService';
import { TicketExtraHeaders, TicketExtraCells } from '../utils/ticketDisplay';

/** Top strip: totals that span the three groups below. */
const HEADLINE_TILES = [
  { id: 'dev', key: 'dev' },
  { id: 'mustFix', key: 'mustFix' },
];

const DEV_GROUP_TILES = [
  { id: 'devTasks', key: 'devTasks', mustFixKey: 'mustFixDevTasks' },
  { id: 'devBugs', key: 'devBugs', mustFixKey: 'mustFixDevBugs' },
  { id: 'devCve', key: 'devCve', mustFixKey: 'mustFixDevCve' },
  { id: 'devOther', key: 'devOther', mustFixKey: 'mustFixDevOther' },
];

const TEST_GROUP_TILES = [
  { id: 'toBeResolved', key: 'toBeResolved' },
  { id: 'qa', key: 'qa' },
];

const KPI_GROUP_TILES = [
  { id: 'regressionProduct', key: 'regressionProduct', mustFixKey: 'mustFixRegressionProduct' },
  { id: 'regressionTest', key: 'regressionTest', mustFixKey: 'mustFixRegressionTest' },
  { id: 'systemTest', key: 'systemTest', mustFixKey: 'mustFixSystemTest' },
];

const HYGIENE_KEYS = [
  'hyDeferredOnRelease',
  'hyOnMaster',
  'hyDeferredWrongTarget',
  'hyMustFixWrongFv',
];

function browseUrl(base, key) {
  if (!base || !key) return '#';
  return `${String(base).replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`;
}

/** Chip from server flags, or labels if flags missing (stale API / casing). */
function rowShowsMustFix(row, release) {
  if (row?.isMustFix) return true;
  const slug = String(release || '')
    .trim()
    .toLowerCase();
  if (!slug) return false;
  const want = [`${slug}-mustfix`, `${String(release || '').trim()}-mustfix`];
  return (row?.labels || []).some((l) => want.includes(String(l)));
}

function rowShowsDeferred(row, release) {
  if (row?.isDeferred) return true;
  const slug = String(release || '')
    .trim()
    .toLowerCase();
  if (!slug) return false;
  const want = [`${slug}-deferred`, `${String(release || '').trim()}-deferred`];
  return (row?.labels || []).some((l) => want.includes(String(l)));
}

function chipSortRank(row, release) {
  if (rowShowsMustFix(row, release)) return 2;
  if (rowShowsDeferred(row, release)) return 1;
  return 0;
}

function parseEmails(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function TileCard({ b, active, loading, onOpen, jiraBase, ofWhich }) {
  if (!b) {
    return (
      <div className="dwb__tile dwb__tile--empty" role="listitem">
        <span className="dwb__tile-label">…</span>
        <span className="dwb__tile-count">{loading ? '…' : '—'}</span>
      </div>
    );
  }
  const jiraUrl = jiraSearchUrl(jiraBase, b.jql);
  return (
    <div
      className={`dwb__tile${active ? ' dwb__tile--active' : ''}`}
      role="listitem"
    >
      <span className="dwb__tile-label">{b.label}</span>
      <button
        type="button"
        className="dwb__tile-count"
        onClick={() => onOpen(b.id)}
        aria-label={`Show ${b.count} ${b.label} tickets`}
      >
        {b.count}
      </button>
      {ofWhich ? (
        <button
          type="button"
          className="dwb__tile-ofwhich"
          onClick={() => onOpen(ofWhich.id)}
          aria-label={`Show ${ofWhich.count} must-fix tickets`}
        >
          of which {ofWhich.count} must-fix
        </button>
      ) : null}
      <a
        className="dwb__tile-jira"
        href={jiraUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={b.jql}
      >
        Open in JIRA ↗
      </a>
    </div>
  );
}

function GroupTile({ tile, buckets, drillId, loading, onOpen, jiraBase }) {
  const { key, mustFixKey } = tile;
  const b = buckets[key];
  const mf = mustFixKey ? buckets[mustFixKey] : null;
  const mfCount = Number(b?.mustFixCount ?? mf?.count) || 0;
  return (
    <TileCard
      b={b}
      active={drillId === key || (mustFixKey && drillId === mustFixKey)}
      loading={loading}
      onOpen={onOpen}
      jiraBase={jiraBase}
      ofWhich={mfCount > 0 ? { id: mustFixKey, count: mfCount } : null}
    />
  );
}

function HeroGroup({ id, title, children }) {
  return (
    <div className={`dwb__hero-group dwb__hero-group--${id}`}>
      <h3 className="dwb__hero-group-title">{title}</h3>
      <div className="dwb__tiles dwb__tiles--group" role="list" aria-label={title}>
        {children}
      </div>
    </div>
  );
}

export default function OutstandingWorkSection({
  release,
  jiraBase,
  outstanding,
  loading,
  error,
  reportBusy,
  onPreview,
  onSend,
}) {
  const [drillId, setDrillId] = useState(null);
  const [toInput, setToInput] = useState('ndb-exec-updates@nutanix.com');
  const [previewHtml, setPreviewHtml] = useState('');
  const [sendMsg, setSendMsg] = useState('');

  const buckets = useMemo(() => outstanding?.buckets || {}, [outstanding?.buckets]);
  const hygiene = useMemo(() => outstanding?.hygiene || {}, [outstanding?.hygiene]);
  const byDiscipline = useMemo(
    () => outstanding?.byDiscipline || {},
    [outstanding?.byDiscipline]
  );
  const cfdCfi = outstanding?.cfdCfi || null;
  const cfdCfiCats = useMemo(
    () => (Array.isArray(cfdCfi?.categories) ? cfdCfi.categories : []),
    [cfdCfi]
  );
  const hygieneTotal = Number(outstanding?.meta?.hygieneTotal) || 0;

  useEffect(() => {
    const rec = outstanding?.reportRecipients;
    if (!rec) return;
    if (Array.isArray(rec.to) && rec.to.length) {
      setToInput(rec.to.join(', '));
    }
  }, [outstanding?.reportRecipients, outstanding?.release]);

  const drillBucket = useMemo(() => {
    if (!drillId) return null;
    if (buckets[drillId]) return buckets[drillId];
    if (hygiene[drillId]) return hygiene[drillId];
    if (byDiscipline[drillId]) {
      return {
        id: drillId,
        label: byDiscipline[drillId].label || drillId,
        ...byDiscipline[drillId],
      };
    }
    if (drillId === 'cfdcfi:all' && cfdCfi) {
      const samples = cfdCfiCats.flatMap((c) => c.sample || []);
      return {
        id: drillId,
        label: 'CFI / CFD',
        count: cfdCfi.total,
        jql: cfdCfi.jql,
        sample: samples,
        truncated: Number(cfdCfi.total) > samples.length,
      };
    }
    const cat = cfdCfiCats.find((c) => c.id === drillId);
    if (cat) {
      return {
        id: cat.id,
        label: cat.name,
        count: cat.count,
        jql: cat.jql,
        sample: cat.sample || [],
        truncated: cat.truncated,
      };
    }
    return null;
  }, [drillId, buckets, hygiene, byDiscipline, cfdCfi, cfdCfiCats]);

  const openDrill = (id) => setDrillId(id);

  const runPreview = async () => {
    setSendMsg('');
    try {
      const data = await onPreview({ to: parseEmails(toInput) });
      setPreviewHtml(data?.html || '');
      if (Array.isArray(data?.to) && data.to.length) {
        setToInput(data.to.join(', '));
      }
    } catch {
      setPreviewHtml('');
    }
  };

  const runSend = async () => {
    setSendMsg('');
    try {
      const data = await onSend({ to: parseEmails(toInput) });
      const ccNote = (data?.cc || []).length ? ` (CC ${(data.cc || []).length})` : '';
      setSendMsg(`Sent: ${data?.subject || 'report'} → ${(data?.to || []).join(', ')}${ccNote}`);
    } catch {
      // error surfaced via outstandingError
    }
  };

  if (!release) return null;

  const mustFixBucket = buckets.mustFix;
  const hygieneChips = HYGIENE_KEYS.map((k) => hygiene[k]).filter(
    (b) => b && Number(b.count) > 0
  );

  return (
    <section className="dwb__outstanding" aria-labelledby="dwb-outstanding-title">
      <div className="dwb__outstanding-head">
        <div>
          <h2 id="dwb-outstanding-title" className="dwb__outstanding-title">
            Outstanding work
          </h2>
          <p className="dwb__outstanding-story">
            {loading && !outstanding
              ? 'Loading outstanding buckets…'
              : outstanding?.story || 'Pick a release to see what is still not Closed.'}
          </p>
          {Number(outstanding?.moveDeferPending?.count) > 0 ? (
            <p className="dwb__outstanding-movedefer">
              <a
                href={jiraSearchUrl(jiraBase, outstanding.moveDeferPending.jql)}
                target="_blank"
                rel="noopener noreferrer"
                className="dwb__outstanding-movedefer-count"
                title={outstanding.moveDeferPending.jql}
                aria-label={`${outstanding.moveDeferPending.count} still on the Move/Defer queue — open in JIRA`}
              >
                {outstanding.moveDeferPending.count}
              </a>{' '}
              still on the Move/Defer queue
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="dwb__err" role="alert">
          {error}
        </div>
      ) : null}

      <div className="dwb__tiles dwb__tiles--headline" role="list" aria-label="Dev open and Must-fix">
        {HEADLINE_TILES.map(({ key }) => (
          <TileCard
            key={key}
            b={buckets[key]}
            active={drillId === key}
            loading={loading}
            onOpen={openDrill}
            jiraBase={jiraBase}
            ofWhich={
              key === 'dev' && mustFixBucket
                ? { id: 'mustFix', count: mustFixBucket.count }
                : null
            }
          />
        ))}
      </div>

      <div className="dwb__hero-band">
        <HeroGroup id="dev" title="Dev">
          {DEV_GROUP_TILES.map((tile) => (
            <GroupTile
              key={tile.key}
              tile={tile}
              buckets={buckets}
              drillId={drillId}
              loading={loading}
              onOpen={openDrill}
              jiraBase={jiraBase}
            />
          ))}
        </HeroGroup>

        <HeroGroup id="test" title="Test">
          {TEST_GROUP_TILES.map((tile) => (
            <GroupTile
              key={tile.key}
              tile={tile}
              buckets={buckets}
              drillId={drillId}
              loading={loading}
              onOpen={openDrill}
              jiraBase={jiraBase}
            />
          ))}
        </HeroGroup>

        <HeroGroup id="kpi" title="KPI">
          {KPI_GROUP_TILES.map((tile) => (
            <GroupTile
              key={tile.key}
              tile={tile}
              buckets={buckets}
              drillId={drillId}
              loading={loading}
              onOpen={openDrill}
              jiraBase={jiraBase}
            />
          ))}
          <TileCard
            b={
              cfdCfi
                ? {
                    id: 'cfdcfi:all',
                    label: cfdCfi.label || 'CFI / CFD',
                    count: Number(cfdCfi.total) || 0,
                    jql: cfdCfi.jql || '',
                  }
                : null
            }
            active={drillId === 'cfdcfi:all' || String(drillId || '').startsWith('cfdcfi:')}
            loading={loading}
            onOpen={openDrill}
            jiraBase={jiraBase}
          />
        </HeroGroup>
      </div>

      {cfdCfiCats.length > 0 ? (
        <div className="dwb__cfdcfi" aria-label="CFI and CFD categories">
          <span className="dwb__cfdcfi-label">CFI / CFD breakdown</span>
          {cfdCfiCats.map((c) => (
            <span
              key={c.id}
              className={`dwb__cfdcfi-item${drillId === c.id ? ' dwb__cfdcfi-item--active' : ''}`}
            >
              <button
                type="button"
                className="dwb__cfdcfi-chip"
                onClick={() => openDrill(c.id)}
                title={c.jql}
                aria-label={`Show ${c.count} ${c.name} tickets`}
              >
                <strong>{c.count}</strong> {c.name}
              </button>
              <a
                className="dwb__tile-jira"
                href={jiraSearchUrl(jiraBase, c.jql)}
                target="_blank"
                rel="noopener noreferrer"
                title={c.jql}
                aria-label={`Open ${c.name} in JIRA`}
              >
                ↗
              </a>
            </span>
          ))}
        </div>
      ) : null}

      {Object.keys(byDiscipline).length > 0 ? (
        <div className="dwb__disc-row">
          <span className="dwb__disc-label">Companion / cross functional teams</span>
          {Object.entries(byDiscipline)
            .sort((a, b) => (b[1].count || 0) - (a[1].count || 0) || a[0].localeCompare(b[0]))
            .map(([pk, d]) => (
              <button
                key={pk}
                type="button"
                className={`dwb__disc-chip${drillId === pk ? ' dwb__disc-chip--active' : ''}`}
                onClick={() => openDrill(pk)}
                title={d.name && d.name !== pk ? d.name : d.jql}
                aria-label={`Show ${d.count} ${pk} tickets`}
              >
                <strong>{d.count}</strong> {pk}
              </button>
            ))}
        </div>
      ) : null}

      {hygieneChips.length > 0 || hygieneTotal > 0 ? (
        <div className="dwb__hygiene" aria-label="Hygiene — cleanup, not capacity">
          <span className="dwb__hygiene-label">Hygiene</span>
          <span className="dwb__hygiene-hint">Cleanup, not capacity</span>
          {hygieneChips.map((b) => (
            <span
              key={b.id}
              className={`dwb__hygiene-item${drillId === b.id ? ' dwb__hygiene-item--active' : ''}`}
            >
              <button
                type="button"
                className="dwb__hygiene-chip"
                onClick={() => openDrill(b.id)}
                title={b.jql}
                aria-label={`Show ${b.count} ${b.label} tickets`}
              >
                <strong>{b.count}</strong> {b.label}
              </button>
              <a
                className="dwb__tile-jira"
                href={jiraSearchUrl(jiraBase, b.jql)}
                target="_blank"
                rel="noopener noreferrer"
                title={b.jql}
                aria-label={`Open ${b.label} in JIRA`}
              >
                ↗
              </a>
            </span>
          ))}
        </div>
      ) : null}

      {drillBucket ? (
        <div className="dwb__drill" role="region" aria-label={`${drillBucket.label} ticket table`}>
          <div className="dwb__drill-head">
            <h3>
              {drillBucket.label}{' '}
              <span className="dwb__muted">
                (showing {drillBucket.sample?.length || 0}
                {drillBucket.truncated ? ` of ${drillBucket.count}` : ''})
              </span>
            </h3>
            <div className="dwb__drill-actions">
              <a
                className="dwb__tile-jira"
                href={jiraSearchUrl(jiraBase, drillBucket.jql)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in JIRA ↗
              </a>
              <button type="button" className="dwb__btn dwb__btn--ghost" onClick={() => setDrillId(null)}>
                Close
              </button>
            </div>
          </div>
          {(drillBucket.sample || []).length === 0 ? (
            <p className="dwb__empty">No tickets in this bucket.</p>
          ) : (
            <div className="dwb__drill-table-wrap">
              <table className="dwb__drill-table">
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">fixVersion</th>
                    <th scope="col">Assignee</th>
                    <TicketExtraHeaders />
                  </tr>
                </thead>
                <tbody>
                  {[...(drillBucket.sample || [])]
                    .sort((a, b) => {
                      const d = chipSortRank(b, release) - chipSortRank(a, release);
                      return d !== 0 ? d : String(a.key).localeCompare(String(b.key));
                    })
                    .map((row) => (
                      <tr key={row.key}>
                        <td>
                          <a
                            href={browseUrl(jiraBase, row.key)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.key}
                          </a>
                          {rowShowsMustFix(row, release) ? (
                            <span className="dwb__label-chip dwb__label-chip--mustfix">
                              Must-fix
                            </span>
                          ) : null}
                          {rowShowsDeferred(row, release) ? (
                            <span className="dwb__label-chip dwb__label-chip--deferred">
                              Allowed deferral
                            </span>
                          ) : null}
                          {row.cfdCfiCategory ? (
                            <span className="dwb__label-chip dwb__label-chip--cfdcfi">
                              {row.cfdCfiCategory}
                            </span>
                          ) : null}
                        </td>
                        <td className="dwb__drill-sum">{row.summary || '—'}</td>
                        <td>{row.issueType || '—'}</td>
                        <td>{row.status || '—'}</td>
                        <td>{row.priority || '—'}</td>
                        <td>
                          {(row.fixVersions || []).length
                            ? (row.fixVersions || []).join(', ')
                            : '—'}
                        </td>
                        <td>{row.assignee || '—'}</td>
                        <TicketExtraCells row={row} />
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="dwb__report">
        <h3 className="dwb__report-title">Send outstanding report</h3>
        <p className="dwb__muted">
          Outstanding mail for {release}. To: ndb-exec-updates@ · CC: current-release
          DRIs, ndb-tech-leads@, ndb-managers@.
        </p>
        <div className="dwb__report-fields">
          <label>
            To
            <input
              type="text"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              placeholder="ndb-exec-updates@nutanix.com"
            />
          </label>
        </div>
        <div className="dwb__actions" style={{ justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="dwb__btn dwb__btn--ghost"
            disabled={reportBusy || !outstanding}
            onClick={runPreview}
          >
            {reportBusy ? 'Working…' : 'Preview'}
          </button>
          <button
            type="button"
            className="dwb__btn"
            disabled={reportBusy || !outstanding || !parseEmails(toInput).length}
            onClick={runSend}
          >
            Send report
          </button>
        </div>
        {sendMsg ? <p className="dwb__report-ok">{sendMsg}</p> : null}
        {previewHtml ? (
          <details className="dwb__report-preview" open>
            <summary>Preview</summary>
            <div
              className="dwb__report-html"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </details>
        ) : null}
      </div>
    </section>
  );
}
