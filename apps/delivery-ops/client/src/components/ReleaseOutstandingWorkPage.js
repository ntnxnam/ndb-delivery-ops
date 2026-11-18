/**
 * Release Outstanding Work — deferral process (top) + outstanding buckets + report.
 * Deferral order: Dev Justification → Dev DRI Move → QA DRI Deferral Label →
 * Dev DRI / QA DRI / QA Must-fix (when mustfix label added).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { PageLoading } from '../shared/components/PageLoading';
import { useTeam } from '../contexts/TeamContext';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { useReleaseOutstandingWork } from '../hooks/useReleaseOutstandingWork';
import { jiraSearchUrl } from '../release/services/releaseBriefService';
import OutstandingWorkSection from './OutstandingWorkSection';
import './ReleaseOutstandingWorkPage.css';

const TABS = {
  justify: 'justify',
  move: 'move',
  defer: 'defer',
  mustfix: 'mustfix',
};

/** Process strip = tablist. Counts come from live queue data. */
const PROCESS_STEPS = [
  {
    id: TABS.justify,
    step: 1,
    role: 'Dev',
    title: 'Justification',
    hint: 'Why deferred',
  },
  {
    id: TABS.move,
    step: 2,
    role: 'Dev DRI',
    title: 'Move (fixVersion)',
    hint: 'Rulebook target',
  },
  {
    id: TABS.defer,
    step: 3,
    role: 'QA DRI',
    title: 'Deferral Label',
    hint: '{release}-deferred',
  },
  {
    id: TABS.mustfix,
    step: 4,
    role: 'Dev DRI · QA DRI · QA',
    title: 'Must-fix',
    hint: 'when mustfix added',
    branch: true,
  },
];

function browseUrl(base, key) {
  if (!base || !key) return '#';
  return `${String(base).replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`;
}

/** Same chips as outstanding drill — current-release mustfix / deferred labels. */
function labelChipFlags(row, release) {
  const labels = row?.labels || [];
  const slug = String(release || '')
    .trim()
    .toLowerCase();
  const raw = String(release || '').trim();
  if (!slug && !raw) {
    return { isMustFix: Boolean(row?.isMustFix), isDeferred: Boolean(row?.isDeferred) };
  }
  const mfWant = [`${slug}-mustfix`, `${raw}-mustfix`];
  const defWant = [`${slug}-deferred`, `${raw}-deferred`];
  return {
    isMustFix: Boolean(row?.isMustFix) || labels.some((l) => mfWant.includes(String(l))),
    isDeferred: Boolean(row?.isDeferred) || labels.some((l) => defWant.includes(String(l))),
  };
}

function OrgChip({ org, count, active, onClick }) {
  const o = org || 'Other';
  return (
    <button
      type="button"
      className={`dwb__chip dwb__chip--${o}${active ? ' dwb__chip--active' : ''}`}
      onClick={onClick}
    >
      {o}
      {count != null ? ` ${count}` : ''}
    </button>
  );
}

function CommentBar({ value, onChange, onPost, posting, disabled, lastComment }) {
  const hasText = Boolean((value || '').trim());
  return (
    <div className="dwb__card-side">
      {lastComment?.body ? (
        <div className="dwb__last-comment" title={lastComment.created || undefined}>
          <div className="dwb__last-comment-meta">
            Last comment
            {lastComment.author ? ` · ${lastComment.author}` : ''}
            {lastComment.age ? ` · ${lastComment.age}` : ''}
          </div>
          <div className="dwb__last-comment-body">{lastComment.body}</div>
        </div>
      ) : lastComment === null ? (
        <div className="dwb__last-comment dwb__last-comment--empty">No comments yet</div>
      ) : null}
      <textarea
        className="dwb__comment"
        rows={2}
        placeholder="JIRA comment (optional)…"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="dwb__actions" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className="dwb__btn dwb__btn--ghost"
          disabled={!hasText || posting || disabled}
          onClick={onPost}
        >
          {posting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}

function TicketHead({ jiraBase, row, release, showJustification = true }) {
  const justification = (row.deferralJustification || '').trim();
  const missing = Boolean(row.missingJustification) || !justification;
  const { isMustFix, isDeferred } = labelChipFlags(row, release);
  return (
    <div>
      <a
        className="dwb__key"
        href={browseUrl(jiraBase, row.key)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {row.key}
      </a>
      {isMustFix ? (
        <span className="dwb__label-chip dwb__label-chip--mustfix">Must-fix</span>
      ) : null}
      {isDeferred ? (
        <span className="dwb__label-chip dwb__label-chip--deferred">Allowed deferral</span>
      ) : null}
      {row.cfdCfiCategory ? (
        <span className="dwb__label-chip dwb__label-chip--cfdcfi">{row.cfdCfiCategory}</span>
      ) : null}
      <span className="dwb__sum">{row.summary}</span>
      {showJustification ? (
        missing ? (
          <div className="dwb__justification dwb__justification--miss">
            <span className="dwb__justification-label">Justification</span>
            <span className="dwb__justification-body">
              Not filled (empty or default preset)
              {row.assignee || row.assigneeManager
                ? ` · ${row.assignee || '—'}${row.assigneeManager ? ` / ${row.assigneeManager}` : ''}`
                : ''}
            </span>
          </div>
        ) : (
          <div className="dwb__justification">
            <span className="dwb__justification-label">Justification</span>
            <span className="dwb__justification-body">{justification}</span>
          </div>
        )
      ) : null}
    </div>
  );
}

function ChaseJustificationBtn({ row, busy, onChase }) {
  if (!row.missingJustification) return null;
  const nudgeHint = row.lastNudgeAt
    ? `Last nudge ${row.lastNudgeAge || ''}`.trim()
    : 'Never nudged';
  return (
    <div className="dwb__chase">
      <button
        type="button"
        className="dwb__btn dwb__btn--chase"
        disabled={!row.canChaseJustification || busy}
        title={
          row.canChaseJustification
            ? `${nudgeHint}. Tags assignee, manager, Dev/QA DRIs, and always CCs you.`
            : 'No assignee or Assignee Manager to tag'
        }
        onClick={onChase}
      >
        {busy ? 'Tagging…' : 'Tag for justification'}
      </button>
      <span
        className="dwb__nudge-age"
        title={row.lastNudgeAt ? `Last nudge at ${row.lastNudgeAt}` : 'No prior nudge comment found'}
      >
        {nudgeHint}
      </span>
    </div>
  );
}

function ChaseStatusUpdateBtn({ row, busy, onChase }) {
  const hours = row.statusStaleHours || 12;
  const activityHint = row.lastActivityAge
    ? `Last activity ${row.lastActivityAge}`
    : 'No recent activity';
  const nudgeHint = row.lastStatusNudgeAt
    ? `Last status ask ${row.lastStatusNudgeAge || ''}`.trim()
    : 'Never asked for status';
  if (!row.needsStatusUpdate) {
    return (
      <div className="dwb__chase">
        <span className="dwb__chip dwb__chip--fresh" title={row.lastActivityAt || undefined}>
          Fresh · {activityHint}
        </span>
        <span className="dwb__nudge-age">Chase after {hours}h silence</span>
      </div>
    );
  }
  return (
    <div className="dwb__chase">
      <span
        className="dwb__chip dwb__chip--stale"
        title={row.lastActivityAt || undefined}
      >
        &gt;{hours}h no update
      </span>
      <button
        type="button"
        className="dwb__btn dwb__btn--chase"
        disabled={!row.canChaseStatusUpdate || busy}
        title={
          row.canChaseStatusUpdate
            ? `${activityHint}. Asks assignee for a status-update comment; CCs manager + DRIs.`
            : 'No assignee or Assignee Manager to tag'
        }
        onClick={onChase}
      >
        {busy ? 'Asking…' : 'Ask for status update'}
      </button>
      <span
        className="dwb__nudge-age"
        title={
          row.lastStatusNudgeAt
            ? `Last status ask at ${row.lastStatusNudgeAt}`
            : 'No prior status-ask comment'
        }
      >
        {nudgeHint}
      </span>
    </div>
  );
}

function formatIssueAge(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function IssueMetaPills({ row, extra }) {
  const created = row.created || null;
  const age = row.createdAge || formatIssueAge(created);
  return (
    <div className="dwb__meta">
      <span className="dwb__pill">
        <strong>Pri</strong> {row.priority || '—'}
      </span>
      <span className="dwb__pill" title={created ? `Created ${created}` : undefined}>
        <strong>Age</strong> {age || '—'}
      </span>
      <span className="dwb__pill">
        <strong>Affected</strong>{' '}
        {(row.affectedVersions || []).join(', ') || '—'}
      </span>
      <span className="dwb__pill">
        <strong>Assignee</strong> {row.assignee || '—'}
      </span>
      <span className="dwb__pill">
        <strong>QA</strong> {row.qaContact || '—'}
      </span>
      {extra}
    </div>
  );
}

export default function ReleaseOutstandingWorkPage() {
  const { selectedTeamId } = useTeam();
  const { versions, selectedRelease, setSelectedRelease, loadingVersions } = useSelectedRelease();
  const { jiraBaseUrl: cfgBase } = useJiraConfig();
  const [orgFilter, setOrgFilter] = useState('All');
  const [tab, setTab] = useState(TABS.justify);
  const [comments, setComments] = useState({});

  const release = selectedRelease || '';
  const {
    data,
    outstanding,
    loading,
    outstandingLoading,
    error,
    outstandingError,
    actionKey,
    reportBusy,
    reload,
    move,
    defer,
    mustFix,
    postComment,
    chaseJustification,
    chaseStatusUpdate,
    previewOutstandingReport,
    sendOutstandingReport,
  } = useReleaseOutstandingWork({
    teamId: selectedTeamId,
    release,
  });

  useEffect(() => {
    setComments({});
  }, [release]);

  const setComment = (key, value) => {
    setComments((prev) => ({ ...prev, [key]: value }));
  };

  const runWithComment = async (key, action) => {
    const text = comments[key] || '';
    try {
      await action(text);
      setComments((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      // keep draft
    }
  };

  const jiraBase = data?.jiraBaseUrl || cfgBase || 'https://jira.nutanix.com';

  const versionNames = useMemo(
    () =>
      (versions || [])
        .map((v) => (typeof v === 'string' ? v : v?.name))
        .filter(Boolean),
    [versions]
  );

  const mustFixRows = useMemo(() => {
    const rows = data?.mustFix || [];
    if (orgFilter === 'All') return rows;
    return rows.filter((r) => r.mustFixOrg === orgFilter);
  }, [data, orgFilter]);

  const missingTargetCount = (data?.candidates || []).filter((c) => !c.targetExists).length;
  const needsJustification = data?.needsJustification || [];

  const stepCounts = useMemo(() => {
    if (!data) {
      return {
        [TABS.justify]: null,
        [TABS.move]: null,
        [TABS.defer]: null,
        [TABS.mustfix]: null,
      };
    }
    return {
      [TABS.justify]: needsJustification.length,
      [TABS.move]: data.candidates.length,
      [TABS.defer]: data.awaitingDeferral.length,
      [TABS.mustfix]: data.mustFix.length,
    };
  }, [data, needsJustification.length]);

  const stepWarn = {
    [TABS.justify]: needsJustification.length > 0,
    [TABS.move]: missingTargetCount > 0,
    [TABS.defer]: false,
    [TABS.mustfix]: false,
  };

  const stepExtra = {
    [TABS.move]:
      missingTargetCount > 0 ? `${missingTargetCount} missing target` : null,
    [TABS.defer]:
      data?.nonDriMoveCount > 0 ? `${data.nonDriMoveCount} non–Dev DRI` : null,
  };

  return (
    <div className="dwb">
      <div className="dwb__header">
        <div className="dwb__header-text">
          <h1 className="dwb__title">Release Outstanding Work</h1>
          <p className="dwb__advice">Typically used after Promotion Gate (PG).</p>
        </div>
        <div className="dwb__picker">
          <label htmlFor="dwb-release">Release</label>
          <select
            id="dwb-release"
            value={release}
            disabled={loadingVersions}
            onChange={(e) => setSelectedRelease(e.target.value)}
          >
            <option value="">Select release…</option>
            {versionNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="dwb__btn dwb__btn--ghost"
          onClick={reload}
          disabled={!release || loading || outstandingLoading}
        >
          Refresh
        </button>
      </div>

      <section className="dwb__section" aria-label="Deferral process">
        <h2 className="dwb__section-title">Deferral process</h2>
        <div className="dwb__steps" role="tablist" aria-label="Deferral queues">
          {PROCESS_STEPS.map((s, i) => {
            const count = stepCounts[s.id];
            const active = tab === s.id;
            const warn = Boolean(stepWarn[s.id]);
            const hint = s.hint.replace('{release}', release || 'release');
            const disabled = !data;
            return (
              <React.Fragment key={s.id}>
                {s.branch ? <div className="dwb__steps-rule" aria-hidden="true" /> : null}
                {i > 0 && !s.branch ? (
                  <span className="dwb__steps-arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={disabled}
                  className={`dwb__step${active ? ' dwb__step--active' : ''}${
                    warn ? ' dwb__step--warn' : ''
                  }${s.branch ? ' dwb__step--branch' : ''}`}
                  onClick={() => setTab(s.id)}
                >
                  <span className="dwb__step-role">{s.role}</span>
                  <span className="dwb__step-title">
                    <span className="dwb__step-num">{s.step}</span> {s.title}
                  </span>
                  <span className="dwb__step-count">
                    {count == null ? (loading ? '…' : '—') : count}
                    {stepExtra[s.id] ? (
                      <span className="dwb__muted"> · {stepExtra[s.id]}</span>
                    ) : null}
                  </span>
                  <span className="dwb__step-hint">{hint}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {Number(data?.cfdCfi?.total) > 0 ? (
        <div className="dwb__cfdcfi" aria-label="CFI and CFD on this release">
          <span className="dwb__cfdcfi-label">CFI / CFD</span>
          <span className="dwb__cfdcfi-hint">
            Customer impact on {release || 'this release'} — open chip in Outstanding for the list
          </span>
          <span className="dwb__cfdcfi-chip dwb__cfdcfi-chip--active">
            <strong>{data.cfdCfi.total}</strong> All
          </span>
          {(data.cfdCfi.categories || []).map((c) => (
            <span key={c.id} className="dwb__cfdcfi-item">
              <span className="dwb__cfdcfi-chip">
                <strong>{c.count}</strong> {c.name}
              </span>
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
          {data.cfdCfi.jql ? (
            <a
              className="dwb__tile-jira"
              href={jiraSearchUrl(jiraBase, data.cfdCfi.jql)}
              target="_blank"
              rel="noopener noreferrer"
              title={data.cfdCfi.jql}
              aria-label="Open all CFI/CFD in JIRA"
            >
              Open in JIRA ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="dwb__err" role="alert">
          {error}
        </div>
      ) : null}

      {!release ? (
        <p className="dwb__empty">Pick a release to load queues.</p>
      ) : loading && !data ? (
        <PageLoading message="Loading outstanding work…" />
      ) : data ? (
        <>
          {tab === TABS.justify ? (
            <section className="dwb__panel" role="tabpanel">
              <div className="dwb__panel-head">
                <div>
                  <h2>Dev — Justification</h2>
                  <p className="dwb__panel-hint">
                    In {release}-All, not currently on {release}, still missing the deferred label
                    and a real justification. Dev fills why deferred; Tag assignee (and manager)
                    to chase. After it is filled, the ticket moves to QA Deferral Label.
                    {data.devDRIs?.length ? ` Dev DRIs (CC): ${data.devDRIs.join(', ')}.` : ''}
                  </p>
                </div>
                <a
                  className="dwb__tab-link"
                  href={jiraSearchUrl(jiraBase, data.jql.needsJustification)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Full ${release}-All · not on ${release} pool in JIRA. This tab lists unanswered/default justification only.`}
                >
                  Open in JIRA ↗
                </a>
              </div>

              {needsJustification.length === 0 ? (
                <p className="dwb__empty">No tickets missing a real deferral justification.</p>
              ) : (
                <>
                  {(data.awaitingDeferral || []).length + needsJustification.length >
                  needsJustification.length ? (
                    <p className="dwb__panel-hint">
                      Showing {needsJustification.length} unanswered/default of{' '}
                      {needsJustification.length + (data.awaitingDeferral || []).length} in the{' '}
                      {release}-All · not on {release} pool (Open in JIRA ↗).
                    </p>
                  ) : null}
                <div className="dwb__list">
                  {needsJustification.map((row) => (
                    <article key={row.key} className="dwb__card dwb__card--nondri">
                      <div className="dwb__card-main">
                        <TicketHead jiraBase={jiraBase} row={row} release={release} />
                        <IssueMetaPills
                          row={row}
                          extra={
                            <>
                              <span className="dwb__pill dwb__pill--accent">
                                <strong>In</strong> {release}-All
                              </span>
                              <span className="dwb__pill">
                                <strong>Not on</strong> {release} · now{' '}
                                {(row.fixVersions || []).join(', ') || '—'}
                              </span>
                              <span className="dwb__pill">
                                <strong>Moved off by</strong> {row.movedBy || '—'}
                                {row.movedByDevDri === true ? ' · Dev DRI' : ''}
                                {row.highlightNonDriMove ? ' · not Dev DRI' : ''}
                              </span>
                            </>
                          }
                        />
                      </div>

                      <CommentBar
                        value={comments[row.key]}
                        onChange={(v) => setComment(row.key, v)}
                        posting={actionKey === `comment:${row.key}`}
                        lastComment={row.lastComment}
                        onPost={() =>
                          runWithComment(row.key, (c) => postComment(row.key, c))
                        }
                      />

                      <div className="dwb__actions">
                        <ChaseJustificationBtn
                          row={row}
                          busy={actionKey === `chase:${row.key}`}
                          onChase={() => chaseJustification(row.key)}
                        />
                      </div>
                    </article>
                  ))}
                </div>
                </>
              )}
            </section>
          ) : null}

          {tab === TABS.move ? (
            <section className="dwb__panel" role="tabpanel">
              <div className="dwb__panel-head">
                <div>
                  <h2>Dev DRI — Move</h2>
                  <p className="dwb__panel-hint">
                    Still on {release} · no mustfix / deferred. P0/P1 → next dot · else → next
                    major/minor that exists.
                    {data.devDRIs?.length ? ` Dev DRIs: ${data.devDRIs.join(', ')}.` : ''}
                  </p>
                </div>
                <a
                  className="dwb__tab-link"
                  href={jiraSearchUrl(jiraBase, data.jql.candidates)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in JIRA ↗
                </a>
              </div>

              {(data.candidates || []).length === 0 ? (
                <p className="dwb__empty">No open Bug/Improvement candidates on {release}.</p>
              ) : (
                <div className="dwb__list">
                  {data.candidates.map((row) => (
                    <article
                      key={row.key}
                      className={`dwb__card${!row.targetExists ? ' dwb__card--miss' : ''}`}
                    >
                      <div className="dwb__card-main">
                        <TicketHead jiraBase={jiraBase} row={row} release={release} />
                        <IssueMetaPills
                          row={row}
                          extra={
                            <>
                              <span className="dwb__pill">
                                <strong>Now</strong>{' '}
                                {(row.fixVersions || []).join(', ') || '—'}
                              </span>
                              <span
                                className={`dwb__pill${!row.targetExists ? ' dwb__pill--warn' : ''}`}
                              >
                                <strong>Expected target</strong> {row.rulebook?.target || '—'}
                              </span>
                              {!row.targetExists ? (
                                <span className="dwb__pill dwb__pill--warn">
                                  Create version in JIRA first
                                </span>
                              ) : (
                                <span className="dwb__muted">{row.rulebook?.reason}</span>
                              )}
                            </>
                          }
                        />
                      </div>

                      <CommentBar
                        value={comments[row.key]}
                        onChange={(v) => setComment(row.key, v)}
                        posting={actionKey === `comment:${row.key}`}
                        lastComment={row.lastComment}
                        onPost={() =>
                          runWithComment(row.key, (c) => postComment(row.key, c))
                        }
                      />

                      <div className="dwb__actions">
                        <button
                          type="button"
                          className="dwb__btn"
                          disabled={!row.canMove || actionKey === `move:${row.key}`}
                          onClick={() => runWithComment(row.key, (c) => move(row.key, c))}
                        >
                          {actionKey === `move:${row.key}` ? 'Moving…' : 'Move'}
                        </button>
                        <button
                          type="button"
                          className="dwb__btn dwb__btn--must"
                          disabled={actionKey === `mustfix:${row.key}`}
                          onClick={() => runWithComment(row.key, (c) => mustFix(row.key, c))}
                          title={`Add ${data.labels.mustFix}`}
                        >
                          Must-fix
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === TABS.defer ? (
            <section className="dwb__panel" role="tabpanel">
              <div className="dwb__panel-head">
                <div>
                  <h2>QA DRI — Deferral Label</h2>
                  <p className="dwb__panel-hint">
                    Justification filled · in {release}-All · not on {release} · still need{' '}
                    <code>{data.labels.deferred}</code>. Blue edge = someone other than Dev DRI
                    moved it off — Defer still allowed.
                    {data.qaDRIs?.length ? ` QA DRIs: ${data.qaDRIs.join(', ')}.` : ''}
                  </p>
                </div>
                <a
                  className="dwb__tab-link"
                  href={jiraSearchUrl(jiraBase, data.jql.awaitingDeferral)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in JIRA ↗
                </a>
              </div>

              {(data.awaitingDeferral || []).length === 0 ? (
                <p className="dwb__empty">Nothing waiting for a deferral label.</p>
              ) : (
                <div className="dwb__list">
                  {data.awaitingDeferral.map((row) => (
                    <article
                      key={row.key}
                      className={`dwb__card${
                        row.highlightNonDriMove ? ' dwb__card--nondri' : ''
                      }`}
                    >
                      <div className="dwb__card-main">
                        <TicketHead jiraBase={jiraBase} row={row} release={release} />
                        <IssueMetaPills
                          row={row}
                          extra={
                            <>
                              <span className="dwb__pill">
                                <strong>In</strong> {release}-All
                              </span>
                              <span className="dwb__pill">
                                <strong>Not on</strong> {release} · now{' '}
                                {(row.fixVersions || []).join(', ') || '—'}
                              </span>
                              <span
                                className={`dwb__pill${
                                  row.highlightNonDriMove ? ' dwb__pill--accent' : ''
                                }`}
                              >
                                <strong>Moved off by</strong> {row.movedBy || '—'}
                                {row.highlightNonDriMove ? ' · not Dev DRI' : ''}
                                {row.movedByDevDri === true ? ' · Dev DRI' : ''}
                              </span>
                            </>
                          }
                        />
                      </div>

                      <CommentBar
                        value={comments[row.key]}
                        onChange={(v) => setComment(row.key, v)}
                        posting={actionKey === `comment:${row.key}`}
                        lastComment={row.lastComment}
                        onPost={() =>
                          runWithComment(row.key, (c) => postComment(row.key, c))
                        }
                      />

                      <div className="dwb__actions">
                        <button
                          type="button"
                          className="dwb__btn"
                          disabled={actionKey === `defer:${row.key}`}
                          onClick={() => runWithComment(row.key, (c) => defer(row.key, c))}
                        >
                          {actionKey === `defer:${row.key}` ? 'Labeling…' : 'Defer'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === TABS.mustfix ? (
            <section className="dwb__panel" role="tabpanel">
              <div className="dwb__panel-head">
                <div>
                  <h2>Must-fix</h2>
                  <p className="dwb__panel-hint">
                    Label <code>{data.labels.mustFix}</code> — Dev DRI, QA DRI, or QA team
                    member. Keep in release. No deferral justification. Ask for a status-update
                    comment when silent ≥
                    {(data.mustFix[0] && data.mustFix[0].statusStaleHours) || 12}h. Chip = who
                    added the label.
                  </p>
                </div>
                <a
                  className="dwb__tab-link"
                  href={jiraSearchUrl(jiraBase, data.jql.mustFix)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in JIRA ↗
                </a>
              </div>

              <div className="dwb__chips">
                <button
                  type="button"
                  className={`dwb__chip${orgFilter === 'All' ? ' dwb__chip--active' : ''}`}
                  onClick={() => setOrgFilter('All')}
                >
                  All {data.mustFix.length}
                </button>
                {['QA', 'Serv', 'PM', 'Other'].map((o) => (
                  <OrgChip
                    key={o}
                    org={o}
                    count={data.orgCounts?.[o] ?? 0}
                    active={orgFilter === o}
                    onClick={() => setOrgFilter(o)}
                  />
                ))}
              </div>

              {mustFixRows.length === 0 ? (
                <p className="dwb__empty">No open must-fix tickets for this filter.</p>
              ) : (
                <div className="dwb__list">
                  {mustFixRows.map((row) => (
                    <article
                      key={row.key}
                      className={`dwb__card${row.needsStatusUpdate ? ' dwb__card--miss' : ''}`}
                    >
                      <div className="dwb__card-main">
                        <TicketHead
                          jiraBase={jiraBase}
                          row={row}
                          release={release}
                          showJustification={false}
                        />
                        <IssueMetaPills
                          row={row}
                          extra={
                            <>
                              <span className="dwb__pill">
                                <strong>fixVersion</strong>{' '}
                                {(row.fixVersions || []).join(', ') || '—'}
                              </span>
                              <span
                                className={`dwb__pill${
                                  row.needsStatusUpdate ? ' dwb__pill--warn' : ''
                                }`}
                                title={row.lastActivityAt || undefined}
                              >
                                <strong>Last activity</strong> {row.lastActivityAge || '—'}
                              </span>
                              {row.needsStatusUpdate ? (
                                <span
                                  className="dwb__chip dwb__chip--stale"
                                  title={row.lastActivityAt || undefined}
                                >
                                  &gt;{row.statusStaleHours || 12}h no update
                                </span>
                              ) : null}
                              <span className="dwb__pill">
                                <strong>Added by</strong> {row.mustFixAuthor || '—'}
                              </span>
                              <span className={`dwb__chip dwb__chip--${row.mustFixOrg || 'Other'}`}>
                                {row.mustFixOrg || 'Other'}
                              </span>
                            </>
                          }
                        />
                      </div>

                      <CommentBar
                        value={comments[row.key]}
                        onChange={(v) => setComment(row.key, v)}
                        posting={actionKey === `comment:${row.key}`}
                        lastComment={row.lastComment}
                        onPost={() =>
                          runWithComment(row.key, (c) => postComment(row.key, c))
                        }
                      />

                      <div className="dwb__actions">
                        <ChaseStatusUpdateBtn
                          row={row}
                          busy={actionKey === `status:${row.key}`}
                          onChase={() => chaseStatusUpdate(row.key)}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {release ? (
        <OutstandingWorkSection
          release={release}
          jiraBase={jiraBase}
          outstanding={outstanding}
          loading={outstandingLoading}
          error={outstandingError}
          reportBusy={reportBusy}
          onPreview={previewOutstandingReport}
          onSend={sendOutstandingReport}
        />
      ) : null}
    </div>
  );
}
