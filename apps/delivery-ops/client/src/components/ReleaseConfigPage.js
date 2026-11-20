import React, { useState, useEffect, useCallback } from 'react';
import { PageLoading } from '../shared/components/PageLoading';
import ReleaseGantt from './ReleaseGantt';
import { useNotifications } from '../shared/services/notificationService';

/**
 * Numbered gate revisions — one key per slip, reasons live on each entry.
 *
 * Correct shape (any other update path is wrong):
 *   gate1: { label, date, color, style: "dotted", reason: "…" }
 *   gate2: { label, date, color, style: "dotted", reason: "…" }
 *   gate3: { label, date, color, style: "solid",  reason: "…" }
 *
 * On slip: mark previous solid → dotted (keep its reason), append next solid slot.
 * Never overwrite, rotate, or push into overflow.
 */
function numberedGateColumn({ key, label, isGA, color, keyFor, parseNum, defaultLabel }) {
  const slotsOf = (cfg) => {
    const nums = Object.keys(cfg || {})
      .map(k => parseNum(k))
      .filter(n => n != null)
      .sort((a, b) => a - b);
    return nums.length ? nums.map(n => keyFor(n)) : [keyFor(1)];
  };
  const lastFilled = (cfg) => {
    const slots = slotsOf(cfg);
    return [...slots].reverse().find(k => cfg?.[k]?.date) || null;
  };
  return {
    key,
    label,
    isGA: !!isGA,
    getAll: (cfg) => slotsOf(cfg).map(k => cfg?.[k]).filter(x => x?.date),
    getCurrent: (cfg) => {
      const last = lastFilled(cfg);
      return last ? cfg[last].date : '';
    },
    setCurrent: (cfg, v) => {
      if (!v) return cfg;
      const last = lastFilled(cfg);
      if (!last) {
        return {
          ...cfg,
          [keyFor(1)]: { label: `${defaultLabel} 1`, date: v, color, style: 'solid' },
        };
      }
      if (cfg[last]?.date === v) return cfg;
      const nextNum = parseNum(last) + 1;
      const nextKey = keyFor(nextNum);
      return {
        ...cfg,
        [last]: { ...cfg[last], style: 'dotted' },
        [nextKey]: { label: `${defaultLabel} ${nextNum}`, date: v, color, style: 'solid' },
      };
    },
    stampReason: (cfg, r) => {
      const last = lastFilled(cfg);
      return last ? { ...cfg, [last]: { ...cfg[last], reason: r } } : cfg;
    },
  };
}

/**
 * Gate column definitions.
 *
 * getAll(cfg)         → [{ date, reason? }, …] in chronological order
 * getCurrent(cfg)     → current date string
 * setCurrent(cfg, v)  → append a new numbered revision; previous becomes dotted
 * stampReason(cfg, r) → write reason onto the latest (current) slot
 */
const GATE_COLUMNS = [
  {
    key: 'ec',
    label: 'EC',
    isGA: false,
    getAll:     cfg => cfg?.ecDate ? [{ date: cfg.ecDate, reason: cfg.ecDateReason }] : [],
    getCurrent: cfg => cfg?.ecDate || '',
    setCurrent: (cfg, v) => ({ ...cfg, ecDate: v || null }),
    stampReason:(cfg, r) => ({ ...cfg, ecDateReason: r }),
  },
  numberedGateColumn({
    key: 'ccm',
    label: 'CCM',
    color: '#de350b',
    defaultLabel: 'Code Complete',
    keyFor: n => `ccm${n}Gate`,
    parseNum: k => {
      const m = /^ccm(\d+)Gate$/.exec(k);
      return m ? parseInt(m[1], 10) : null;
    },
  }),
  numberedGateColumn({
    key: 'cg',
    label: 'CG',
    color: '#ff9800',
    defaultLabel: 'Commit Gate',
    keyFor: n => `commitGate${n}`,
    parseNum: k => {
      const m = /^commitGate(\d+)$/.exec(k);
      return m ? parseInt(m[1], 10) : null;
    },
  }),
  numberedGateColumn({
    key: 'pg',
    label: 'PG',
    color: '#9c27b0',
    defaultLabel: 'Promotion Gate',
    keyFor: n => `promotionGate${n}`,
    parseNum: k => {
      const m = /^promotionGate(\d+)$/.exec(k);
      return m ? parseInt(m[1], 10) : null;
    },
  }),
  numberedGateColumn({
    key: 'ga',
    label: 'GA',
    isGA: true,
    color: '#28a745',
    defaultLabel: 'GA',
    keyFor: n => `ga${n}`,
    parseNum: k => {
      const m = /^ga(\d+)$/.exec(k);
      return m ? parseInt(m[1], 10) : null;
    },
  }),
];

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y?.slice(2)}`;
}

// ── Quick inline date entry for empty cells ───────────────────────────────────
function QuickDateInput({ onCommit }) {
  const [open, setOpen] = useState(false);
  const inputRef = React.useRef(null);

  function handleOpen() {
    setOpen(true);
    setTimeout(() => inputRef.current?.showPicker?.(), 50);
  }

  function handleChange(e) {
    if (e.target.value) {
      onCommit(e.target.value);
      setOpen(false);
    }
  }

  if (open) {
    return (
      <input
        ref={inputRef}
        type="date"
        className="quick-date-input"
        autoFocus
        onChange={handleChange}
        onBlur={() => setOpen(false)}
      />
    );
  }

  return (
    <button className="quick-date-btn" onClick={handleOpen} title="Add date">
      +
    </button>
  );
}

// ── Info / notes modal (* affordance) ────────────────────────────────────────
function InfoNotesModal({ version, cfg, onSave, onClose }) {
  const jiraMeta = cfg?._jira || cfg?.jiraMeta || null;
  const [notes, setNotes] = useState(cfg?.notes || cfg?.releaseNotes || cfg?.info || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try { await onSave(version, notes); } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box info-notes-modal" role="dialog" aria-modal="true" aria-labelledby="info-notes-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="info-notes-title">{version} — Details</h3>
        <div className="info-meta">
          {jiraMeta ? (
            <table className="info-meta-table">
              <tbody>
                <tr><td>Project</td><td>{jiraMeta.projectKey || '—'}</td></tr>
                <tr><td>Released</td><td>{jiraMeta.released ? 'Yes' : 'No'}</td></tr>
                {jiraMeta.releaseDate && <tr><td>JIRA releaseDate</td><td>{jiraMeta.releaseDate}</td></tr>}
                {jiraMeta.id && <tr><td>JIRA id</td><td>{jiraMeta.id}</td></tr>}
                {jiraMeta.syncedAt && <tr><td>Synced</td><td>{new Date(jiraMeta.syncedAt).toLocaleString()}</td></tr>}
              </tbody>
            </table>
          ) : (
            <p className="info-meta-hint">No JIRA sync data — will appear after next Test Connection.</p>
          )}
          {jiraMeta?.projectKey && (
            <a
              href={`https://jira.nutanix.com/issues/?jql=${encodeURIComponent(`fixVersion = "${version}"`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="info-jira-link"
            >
              Open in JIRA
            </a>
          )}
        </div>
        <label htmlFor="info-notes-input" className="info-notes-label">Notes</label>
        <textarea
          id="info-notes-input"
          className="reason-textarea"
          placeholder="Free-form notes for this release…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          maxLength={2000}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Reasoning modal ───────────────────────────────────────────────────────────
function ReasonModal({ version, changedCols, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const hasGA = changedCols.some(c => c.isGA);
  return (
    <div className="modal-backdrop">
      <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="reason-modal-title">
        <h3 id="reason-modal-title">Why are these dates changing? — {version}</h3>
        <p className="modal-subtitle">Changed: {changedCols.map(c => c.label).join(', ')}.</p>
        {hasGA && (
          <p className="modal-warning">
            GA change will update JIRA (FEAT + ERA) and notify the team by email.
          </p>
        )}
        <label htmlFor="reason-input" className="reason-label">Reason</label>
        <textarea
          id="reason-input"
          className="reason-textarea"
          placeholder="Explain why (e.g. dependency slip, scope change, QA bandwidth)…"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={4}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-primary" onClick={() => onConfirm(reason)} disabled={!reason.trim()}>Save</button>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const ReleaseConfigPage = () => {
  const [releases, setReleases]         = useState({});
  const [editingRow, setEditingRow]     = useState(null);
  const [pendingEdits, setPendingEdits] = useState({});
  const [showModal, setShowModal]       = useState(null);
  const [infoModal, setInfoModal]       = useState(null);
  const [showNewForm, setShowNewForm]   = useState(false);
  const [newVersion, setNewVersion]     = useState('');
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const { success: notifySuccess, error: notifyError } = useNotifications();
  const [releaseConfirm, setReleaseConfirm] = useState(null); // { version, preview, loading }
  const [releasing, setReleasing]       = useState(false);
  const [announce, setAnnounce]         = useState(null); // { version, html, subject, to, loading, error, sending }
  const [announceHtml, setAnnounceHtml] = useState('');
  const [announceSubject, setAnnounceSubject] = useState('');
  const [announceTo, setAnnounceTo] = useState('');

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/config/release-dates');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setReleases(data.releases || {});
    } catch (e) {
      notifyError('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  useEffect(() => {
    const handler = () => loadConfigs();
    window.addEventListener('releaseConfigSynced', handler);
    return () => window.removeEventListener('releaseConfigSynced', handler);
  }, [loadConfigs]);

  function startEdit(version) {
    setEditingRow(version);
    setPendingEdits(prev => ({ ...prev, [version]: JSON.parse(JSON.stringify(releases[version] || {})) }));
  }

  function cancelEdit(version) {
    setEditingRow(null);
    setPendingEdits(prev => { const n = { ...prev }; delete n[version]; return n; });
  }

  function updateCell(version, col, value) {
    setPendingEdits(prev => ({
      ...prev,
      [version]: col.setCurrent(prev[version] || JSON.parse(JSON.stringify(releases[version] || {})), value),
    }));
  }

  function driListEqual(a, b) {
    const norm = (v) =>
      (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/))
        .map((x) => String(x).trim().toLowerCase().split('@')[0])
        .filter(Boolean)
        .sort()
        .join(',');
    return norm(a) === norm(b);
  }

  function detectChangedCols(version) {
    const original = releases[version] || {};
    const edited   = pendingEdits[version] || {};
    return GATE_COLUMNS.filter(col => col.getCurrent(edited) !== col.getCurrent(original));
  }

  function drisChanged(version) {
    const original = releases[version] || {};
    const edited = pendingEdits[version] || {};
    return (
      !driListEqual(original.devDRIs, edited.devDRIs) ||
      !driListEqual(original.qaDRIs, edited.qaDRIs)
    );
  }

  function requestSave(version) {
    const changed = detectChangedCols(version);
    const driOnly = drisChanged(version);
    if (!changed.length && !driOnly) { cancelEdit(version); return; }
    // Gate date slips need a reason; DRI-only edits save immediately
    if (!changed.length && driOnly) {
      doSave(version, pendingEdits[version] || releases[version] || {}, '');
      return;
    }
    setShowModal({ version, changedCols: changed });
  }

  function updateDriField(version, field, value) {
    setPendingEdits((prev) => ({
      ...prev,
      [version]: {
        ...(prev[version] || JSON.parse(JSON.stringify(releases[version] || {}))),
        [field]: value,
      },
    }));
  }

  function formatDriInput(list) {
    if (Array.isArray(list)) return list.join(', ');
    return String(list || '');
  }

  async function confirmSave(reason) {
    const { version, changedCols } = showModal;
    setShowModal(null);

    // Stamp the reason onto every gate that changed
    let cfg = pendingEdits[version] || releases[version] || {};
    for (const col of changedCols) {
      cfg = col.stampReason(cfg, reason);
    }

    await doSave(version, cfg, reason);
  }

  async function doSave(version, cfg, reason) {
    try {
      setSaving(true);
      const body = { version, reason, ...cfg };
      const res = await fetch('/api/config/release-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': localStorage.getItem('username') || '' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      await loadConfigs();
      cancelEdit(version);
      notifySuccess(`${version} saved.`);
    } catch (e) {
      notifyError('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveNewRelease() {
    if (!newVersion.trim()) { notifyError('Version is required'); return; }
    await doSave(newVersion.trim(), {}, '');
    setShowNewForm(false);
    setNewVersion('');
  }

  async function handleInfoSave(version, notes) {
    const cfg = releases[version] || {};
    const payload = { ...cfg, notes, version, reason: '' };
    if (cfg._jira) payload._jira = cfg._jira;
    if (cfg.jiraMeta) payload.jiraMeta = cfg.jiraMeta;
    if (cfg._source) payload._source = cfg._source;
    if (cfg._syncedAt) payload._syncedAt = cfg._syncedAt;
    try {
      const res = await fetch('/api/config/release-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': localStorage.getItem('username') || '' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      await loadConfigs();
      setInfoModal(null);
      notifySuccess(`${version} notes saved.`);
    } catch (e) {
      notifyError('Save failed: ' + e.message);
    }
  }

  async function openReleasePreview(version) {
    setReleaseConfirm({ version, preview: null, loading: true });
    try {
      const res = await fetch(`/api/config/releases/${encodeURIComponent(version)}/release-preview`, { headers: { 'X-Username': localStorage.getItem('username') || '' } });
      const data = await res.json();
      setReleaseConfirm({ version, preview: data, loading: false });
    } catch (e) {
      setReleaseConfirm({ version, preview: { error: e.message }, loading: false });
    }
  }
  async function confirmMarkReleased() {
    if (!releaseConfirm) return;
    const version = releaseConfirm.version;
    setReleasing(true);
    try {
      const res = await fetch(`/api/config/releases/${encodeURIComponent(version)}/mark-released`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Username': localStorage.getItem('username') || '' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || 'Failed').split('\n')[0].slice(0, 300));
      setReleaseConfirm(null);
      await loadConfigs();
      const moved = data.tickets?.moved ?? 0;
      const draft = data.announcementDraft;
      let hint = '';
      if (draft?.skipped) hint = ' Use Announce to send release notes.';
      else if (draft?.error) hint = ` Announcement: ${String(draft.error).split('\n')[0].slice(0, 120)}`;
      notifySuccess(`${version} marked as Released — moved ${moved} open tickets to master.${hint}`);
    } catch (e) {
      const msg = String(e.message).split('\n')[0].slice(0, 300);
      notifyError('Mark released failed: ' + msg);
    } finally { setReleasing(false); }
  }

  async function openAnnouncement(version) {
    setAnnounce({ version, loading: true, error: null, html: '', subject: '', to: '' });
    setAnnounceHtml('');
    setAnnounceSubject('');
    setAnnounceTo('');
    try {
      const res = await fetch(`/api/config/releases/${encodeURIComponent(version)}/announcement-preview`, { headers: { 'X-Username': localStorage.getItem('username') || '' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to preview announcement');
      setAnnounce({ version, loading: false, error: null, ...data });
      setAnnounceHtml(data.html || '');
      setAnnounceSubject(data.subject || '');
      setAnnounceTo(data.to || '');
    } catch (e) {
      setAnnounce({ version, loading: false, error: String(e.message).split('\n')[0].slice(0, 400), html: '' });
    }
  }
  async function sendAnnouncementDraft() {
    if (!announce || !announce.version) return;
    const version = announce.version;
    setAnnounce(prev => prev ? { ...prev, sending: true } : prev);
    try {
      const res = await fetch(`/api/config/releases/${encodeURIComponent(version)}/announcement-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': localStorage.getItem('username') || '' },
        body: JSON.stringify({ html: announceHtml, subject: announceSubject, to: announceTo })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setAnnounce(null);
      notifySuccess(`Announcement draft sent to ${data.to} — ${data.subject}`);
    } catch (e) {
      notifyError('Send announcement failed: ' + String(e.message).split('\n')[0].slice(0, 400));
    } finally {
      setAnnounce(prev => prev ? { ...prev, sending: false } : prev);
    }
  }

  async function handleDelete(version) {
    if (!window.confirm(`Delete config for ${version}?`)) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/config/release-dates/${encodeURIComponent(version)}`, {
        method: 'DELETE',
        headers: { 'X-Username': localStorage.getItem('username') || '' },
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      await loadConfigs();
      notifySuccess(`${version} deleted.`);
    } catch (e) {
      notifyError('Delete failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoading message="Loading release config…" />;

  const versions = Object.keys(releases);

  return (
    <div className="rc-page">
      <div className="rc-header">
        <div>
          <h1>Release Configuration</h1>
          <p>
            Struck-out dates show previous revisions with their reasons. GA changes update JIRA and notify the team.
            Set Dev / QA DRIs per release (usernames) for Release Outstanding Work and email CC.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowNewForm(true)} disabled={saving}>
          + New Release
        </button>
      </div>

      {showNewForm && (
        <div className="new-release-bar">
          <input
            className="new-release-input"
            placeholder="e.g. NDB-2.13"
            value={newVersion}
            onChange={e => setNewVersion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveNewRelease()}
            autoFocus
          />
          <button className="btn-primary" onClick={saveNewRelease} disabled={saving}>Add</button>
          <button className="btn-secondary" onClick={() => { setShowNewForm(false); setNewVersion(''); }}>Cancel</button>
        </div>
      )}

      {versions.length === 0 && !showNewForm ? (
        <div className="rc-empty">
          <p>No releases configured yet.</p>
          <button className="btn-primary" onClick={() => setShowNewForm(true)}>Create First Release</button>
        </div>
      ) : (
        <>
          <ReleaseGantt releases={releases} />
          <div className="rc-table-wrap">
          <table className="rc-table">
            <thead>
              <tr>
                <th className="col-version">Release</th>
                {GATE_COLUMNS.map(col => (
                  <th key={col.key} className={col.isGA ? 'col-ga' : ''}>{col.label}</th>
                ))}
                <th className="col-dri">Dev DRIs</th>
                <th className="col-dri">QA DRIs</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(version => {
                const cfg     = releases[version] || {};
                const draft   = pendingEdits[version] || cfg;
                const editing = editingRow === version;

                return (
                  <tr key={version} className={editing ? 'row-editing' : ''}>
                    <td className="col-version">
                      <span>{version}</span>
                      <button
                        className={`info-btn${(cfg.notes || cfg.releaseNotes || cfg.info) ? ' has-notes' : ''}`}
                        onClick={() => setInfoModal({ version, cfg })}
                        aria-label={`More info for ${version}`}
                        title={cfg.notes || cfg.releaseNotes || cfg.info ? 'Has notes — click to view/edit' : 'JIRA details & notes'}
                      >
                        *
                      </button>
                    </td>

                    {GATE_COLUMNS.map(col => {
                      const allEntries = col.getAll(cfg);   // [{ date, reason? }, …]
                      const prevEntries = allEntries.slice(0, -1);
                      const currentEntry = allEntries[allEntries.length - 1];

                      return (
                        <td key={col.key} className={`date-cell${col.isGA ? ' col-ga' : ''}`}>
                          {editing ? (
                            <input
                              type="date"
                              className="cell-input"
                              value={col.getCurrent(draft)}
                              onChange={e => updateCell(version, col, e.target.value)}
                            />
                          ) : (
                            <div className="date-stack">
                              {prevEntries.map((entry, i) => (
                                <div key={i} className="date-entry">
                                  <s className="date-prev">{fmt(entry.date)}</s>
                                  {entry.reason && <s className="date-reason">{entry.reason}</s>}
                                </div>
                              ))}
                              {currentEntry ? (
                                <div className="date-entry">
                                  <span className="date-current">{fmt(currentEntry.date)}</span>
                                  {currentEntry.reason && (
                                    <span className="date-reason current-reason">{currentEntry.reason}</span>
                                  )}
                                </div>
                              ) : (
                                <QuickDateInput
                                  onCommit={v => {
                                    startEdit(version);
                                    updateCell(version, col, v);
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}

                    <td className="col-dri">
                      {editing ? (
                        <input
                          className="dri-input"
                          placeholder="user1, user2"
                          value={formatDriInput(draft.devDRIs)}
                          onChange={(e) => updateDriField(version, 'devDRIs', e.target.value)}
                          title="Comma-separated usernames (Dev DRI)"
                        />
                      ) : (
                        <span className="dri-text">
                          {Array.isArray(cfg.devDRIs) && cfg.devDRIs.length
                            ? cfg.devDRIs.join(', ')
                            : <span className="date-empty">—</span>}
                        </span>
                      )}
                    </td>
                    <td className="col-dri">
                      {editing ? (
                        <input
                          className="dri-input"
                          placeholder="user1, user2"
                          value={formatDriInput(draft.qaDRIs)}
                          onChange={(e) => updateDriField(version, 'qaDRIs', e.target.value)}
                          title="Comma-separated usernames (QA DRI)"
                        />
                      ) : (
                        <span className="dri-text">
                          {Array.isArray(cfg.qaDRIs) && cfg.qaDRIs.length
                            ? cfg.qaDRIs.join(', ')
                            : <span className="date-empty">—</span>}
                        </span>
                      )}
                    </td>

                    <td className="col-actions">
                      {editing ? (
                        <>
                          <button className="btn-save"   onClick={() => requestSave(version)} disabled={saving}>Save</button>
                          <button className="btn-cancel" onClick={() => cancelEdit(version)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="btn-edit"   onClick={() => startEdit(version)}>Edit</button>
                          {!cfg.released && (
                            <button className="btn-release" onClick={() => openReleasePreview(version)} disabled={saving} title={cfg._jira?.released ? 'Repair lighthouse — JIRA already released' : 'Mark as Released — JIRA + email + move open tickets'}>{cfg._jira?.released ? 'Repair' : 'Release'}</button>
                          )}
                          {cfg.released && <span className="released-badge">● Released</span>}
                          <button className="btn-announce" onClick={() => openAnnouncement(version)} title="Preview & send announcement draft to you (editable)">Announce</button>
                          <button className="btn-delete" onClick={() => handleDelete(version)} disabled={saving}>Del</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      {showModal && (
        <ReasonModal
          version={showModal.version}
          changedCols={showModal.changedCols}
          onConfirm={confirmSave}
          onCancel={() => setShowModal(null)}
        />
      )}

      {releaseConfirm && (
        <div className="modal-backdrop" onClick={() => !releasing && setReleaseConfirm(null)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="release-confirm-title" onClick={e=>e.stopPropagation()} style={{ width: 560 }}>
            <h3 id="release-confirm-title">Mark {releaseConfirm.version} as Released?</h3>
            {releaseConfirm.loading ? <p>Loading preview…</p> : releaseConfirm.preview?.error ? <p className="modal-warning">{releaseConfirm.preview.error}</p> : (
              <>
                <p className="modal-subtitle">This will:</p>
                <ol style={{ fontSize: 13, lineHeight: '1.7' }}>
                  <li>Set lighthouse flag <code>released=true</code> for {releaseConfirm.version}</li>
                  <li>Mark JIRA version as <b>Released</b> in {releaseConfirm.preview?.projectKey}{releaseConfirm.preview?.jiraVersions?.length ? ` + ${(releaseConfirm.preview.jiraVersions||[]).map(v=>v.projectKey).join(', ')}` : ''}</li>
                  <li>Send email to <b>ndb-tpms@nutanix.com</b></li>
                  <li>Move <b>{releaseConfirm.preview?.openCount ?? '?'}</b> open tickets (status NOT IN Done, Complete, Closed, Cancelled, Fixed) to <b>master</b></li>
                  <li>Add comment tagging <b>assignee + assignee manager (assigneeManager)</b> asking to update fixVersion</li>
                </ol>
                <p className="modal-hint">Announcement is separate — use <b>Announce</b> on the release row to preview, edit, and send the draft.</p>
                {releaseConfirm.preview?.alreadyReleased && <p className="modal-warning">Already marked released in lighthouse — action will be rejected.</p>}
                {releaseConfirm.preview?.jiraAlreadyReleased && !releaseConfirm.preview?.alreadyReleased && <p className="modal-warning">JIRA already marked Released — will complete lighthouse + email + ticket move (repair).</p>}
                {releaseConfirm.preview?.jql && <p style={{ fontSize: 11, color: '#6c757d', wordBreak: 'break-all' }}>JQL: <code>{releaseConfirm.preview.jql}</code></p>}
                {releaseConfirm.preview?.sample?.length > 0 && <p style={{ fontSize: 11 }}>Sample: {releaseConfirm.preview.sample.map(s=>s.key).join(', ')}</p>}
              </>
            )}
            <div className="modal-actions">
              <button className="btn-primary" onClick={confirmMarkReleased} disabled={releasing || releaseConfirm.loading}>{releasing ? 'Releasing…' : 'Confirm Mark Released'}</button>
              <button className="btn-secondary" onClick={() => setReleaseConfirm(null)} disabled={releasing}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {infoModal && (
        <InfoNotesModal
          version={infoModal.version}
          cfg={releases[infoModal.version] || infoModal.cfg}
          onSave={handleInfoSave}
          onClose={() => setInfoModal(null)}
        />
      )}

      {announce && (
        <div className="modal-backdrop" onClick={() => !announce.sending && setAnnounce(null)}>
          <div className="modal-box announce-modal" role="dialog" aria-modal="true" aria-labelledby="announce-title" onClick={e=>e.stopPropagation()}>
            <h3 id="announce-title">Announcement Draft — {announce.version}</h3>
            {announce.loading ? <p>Generating preview…</p> : announce.error ? (
              <><p className="modal-warning">{announce.error}</p><div className="modal-actions"><button className="btn-secondary" onClick={() => setAnnounce(null)}>Close</button></div></>
            ) : (
              <>
                <div className="announce-fields">
                  <label className="announce-label">To (draft recipient — edit to redirect)
                    <input className="announce-input" value={announceTo} onChange={e=>setAnnounceTo(e.target.value)} placeholder="you@nutanix.com" />
                  </label>
                  <label className="announce-label">Subject
                    <input className="announce-input" value={announceSubject} onChange={e=>setAnnounceSubject(e.target.value)} />
                  </label>
                  <p className="announce-meta">AI: {announce.aiUsed ? 'generated' : 'fallback template'} • {announce.featureCount} feature(s) • GA {announce.gaDate || 'TBD'}</p>
                </div>
                <div className="announce-review">
                  <div className="announce-preview-pane">
                    <div className="announce-pane-title">Preview (how it will look)</div>
                    <div className="announce-preview" dangerouslySetInnerHTML={{ __html: announceHtml }} />
                  </div>
                  <div className="announce-edit-pane">
                    <div className="announce-pane-title">Edit HTML (changes reflect after send)
                    </div>
                    <textarea className="announce-textarea" value={announceHtml} onChange={e=>setAnnounceHtml(e.target.value)} rows={10} placeholder="Edit announcement HTML here..." />
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={sendAnnouncementDraft} disabled={announce.sending || !announceHtml.trim()}>{announce.sending ? 'Sending…' : 'Send Draft'}</button>
                  <button className="btn-secondary" onClick={() => setAnnounce(null)} disabled={announce.sending}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* notifications via global ToastContainer (top-right) */}

      <style>{`
        .rc-page { padding: 20px 24px; }

        .rc-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e9ecef;
        }
        .rc-header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; color: #222; }
        .rc-header p  { margin: 0; color: #6c757d; font-size: 12px; }

        .rc-loading, .rc-empty { padding: 60px; text-align: center; color: #6c757d; }

        .new-release-bar {
          display: flex; gap: 8px; align-items: center; margin-bottom: 16px;
          padding: 10px 12px; background: #f0f7ff; border: 1px solid #b8d9f8; border-radius: 6px;
        }
        .new-release-input {
          padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 14px; width: 200px;
        }

        .rc-table-wrap { overflow-x: auto; }
        .rc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .rc-table th {
          padding: 8px 12px; background: #f8f9fa; border: 1px solid #dee2e6;
          font-weight: 600; color: #495057; text-align: left;
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .rc-table td { padding: 6px 12px; border: 1px solid #dee2e6; vertical-align: top; }
        .rc-table tbody tr:hover { background: #fafafa; }
        .rc-table tbody tr.row-editing { background: #fffbea; }

        .col-version { font-weight: 600; min-width: 90px; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
        .info-btn {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 22px; min-height: 22px; padding: 0 4px;
          border: 1px solid #ced4da; border-radius: 4px; background: #fff;
          color: #6c757d; font-size: 13px; font-weight: 700; line-height: 1;
          cursor: pointer; transition: all 0.15s;
        }
        .info-btn:hover { border-color: #0d6efd; color: #0d6efd; background: #f0f7ff; }
        .info-btn.has-notes { background: #0d6efd; color: #fff; border-color: #0d6efd; }
        .info-btn.has-notes:hover { background: #0a58ca; }
        .info-meta { margin-bottom: 12px; }
        .info-meta-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .info-meta-table td { padding: 4px 8px; border: 1px solid #e9ecef; }
        .info-meta-table td:first-child { font-weight: 600; color: #495057; background: #f8f9fa; width: 140px; }
        .info-meta-hint { font-size: 12px; color: #6c757d; font-style: italic; margin: 0 0 8px; }
        .info-jira-link { font-size: 12px; color: #0d6efd; text-decoration: none; }
        .info-jira-link:hover { text-decoration: underline; }
        .info-notes-label { display: block; font-size: 12px; font-weight: 600; color: #495057; margin-bottom: 4px; }
        .col-ga      { background: rgba(40,167,69,0.04); }
        .col-dri     { min-width: 120px; max-width: 180px; }
        .col-actions { min-width: 160px; white-space: nowrap; }
        .date-cell   { min-width: 80px; }
        .dri-input {
          width: 100%; min-width: 110px; padding: 3px 6px;
          border: 1px solid #007bff; border-radius: 3px; font-size: 11px; box-sizing: border-box;
        }
        .dri-text { font-size: 11px; color: #333; word-break: break-word; }

        /* Date stack */
        .date-stack   { display: flex; flex-direction: column; gap: 3px; }
        .date-entry   { display: flex; flex-direction: column; gap: 1px; }

        .date-prev    { color: #adb5bd; font-size: 11px; text-decoration: line-through; }
        .date-reason  { font-size: 10px; font-style: italic; color: #bbb; text-decoration: line-through; }
        .date-current { color: #212529; font-weight: 500; font-size: 12px; }
        .current-reason {
          font-size: 10px; font-style: italic; color: #6c757d;
          text-decoration: none; /* not struck through */
        }
        .date-empty   { color: #dee2e6; }

        /* Quick date entry for empty cells */
        .quick-date-btn {
          background: none; border: 1px dashed #ced4da; border-radius: 3px;
          color: #ced4da; font-size: 11px; width: 20px; height: 18px;
          cursor: pointer; padding: 0; line-height: 1;
          transition: all 0.15s;
        }
        .quick-date-btn:hover { border-color: #007bff; color: #007bff; background: #f0f7ff; }
        .quick-date-input {
          padding: 2px 4px; border: 1px solid #007bff; border-radius: 3px;
          font-size: 10px; width: 108px; color: #333;
        }

        .cell-input {
          padding: 3px 6px; border: 1px solid #007bff; border-radius: 3px;
          font-size: 11px; width: 116px;
        }

        .btn-edit, .btn-delete, .btn-save, .btn-cancel {
          padding: 3px 9px; border: none; border-radius: 3px;
          font-size: 11px; font-weight: 500; cursor: pointer; margin-right: 3px;
        }
        .btn-edit   { background: #e9ecef; color: #495057; }
        .btn-delete { background: #fff0f0; color: #dc3545; }
        .btn-save   { background: #007bff; color: #fff; }
        .btn-cancel { background: #e9ecef; color: #495057; }
        .btn-edit:hover   { background: #dee2e6; }
        .btn-delete:hover { background: #ffd5d5; }
        .btn-save:hover   { background: #0056b3; }
        button:disabled   { opacity: 0.55; cursor: not-allowed; }
        .btn-release { background: #28a745; color: #fff; padding: 3px 9px; border: none; border-radius: 3px; font-size: 11px; font-weight: 600; cursor: pointer; margin-right: 3px; }
        .btn-release:hover { background: #1e7e34; }
        .btn-announce { background: #6f42c1; color: #fff; padding: 3px 9px; border: none; border-radius: 3px; font-size: 11px; font-weight: 600; cursor: pointer; margin-right: 3px; }
        .btn-announce:hover { background: #5a32a3; }
        .released-badge { font-size: 11px; color: #28a745; font-weight: 700; margin-right: 6px; }
        .modal-hint { font-size: 12px; color: #6c757d; margin: 8px 0 0; font-style: italic; }
        .announce-modal { width: 720px; max-width: 96vw; max-height: 90vh; overflow-y: auto; }
        .announce-fields { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .announce-label { font-size: 12px; font-weight: 600; color: #495057; display: flex; flex-direction: column; gap: 4px; }
        .announce-input { padding: 6px 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 12px; font-weight: 400; }
        .announce-meta { font-size: 11px; color: #6c757d; margin: 0; }
        .announce-review { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        @media (max-width: 700px) { .announce-review { grid-template-columns: 1fr; } }
        .announce-pane-title { font-size: 11px; font-weight: 700; color: #495057; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
        .announce-preview { border: 1px solid #dee2e6; border-radius: 4px; padding: 12px; max-height: 380px; overflow-y: auto; background: #fff; font-size: 12px; }
        .announce-textarea { width: 100%; min-height: 200px; max-height: 380px; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 11px; font-family: monospace; resize: vertical; box-sizing: border-box; }
        .announce-textarea:focus { outline: none; border-color: #6f42c1; box-shadow: 0 0 0 2px rgba(111,66,193,.15); }

        .btn-primary {
          padding: 7px 14px; background: #007bff; color: #fff;
          border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer;
        }
        .btn-primary:hover:not(:disabled) { background: #0056b3; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-secondary {
          padding: 7px 14px; background: #6c757d; color: #fff;
          border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer;
        }
        .btn-secondary:hover { background: #545b62; }

        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,.45);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
        }
        .modal-box {
          background: #fff; border-radius: 8px; padding: 28px 32px;
          width: 480px; max-width: 95vw; box-shadow: 0 8px 32px rgba(0,0,0,.2);
        }
        .modal-box h3   { margin: 0 0 8px; font-size: 17px; color: #222; }
        .modal-subtitle { font-size: 13px; color: #6c757d; margin: 0 0 8px; }
        .modal-warning  { font-size: 13px; color: #e65100; font-weight: 600; margin: 0 0 12px; }
        .reason-textarea {
          width: 100%; padding: 10px; border: 1px solid #ced4da; border-radius: 4px;
          font-size: 14px; resize: vertical; box-sizing: border-box;
        }
        .reason-textarea:focus { outline: none; border-color: #007bff; box-shadow: 0 0 0 2px rgba(0,123,255,.2); }
        .modal-actions { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
      `}</style>
    </div>
  );
};

export default ReleaseConfigPage;
