import React, { useState, useEffect, useCallback } from 'react';
import { Toast } from '../shared/components/Toast';
import ReleaseGantt from './ReleaseGantt';

/**
 * Gate column definitions.
 *
 * getAll(cfg)         → [{ date, reason? }, …] in chronological order
 * getCurrent(cfg)     → current date string
 * setCurrent(cfg, v)  → new config with v appended as the latest revision
 * stampReason(cfg, r) → new config with r written onto the latest slot
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
  {
    key: 'ccm',
    label: 'CCM',
    isGA: false,
    getAll: cfg => [
      ...(cfg?.ccm1Gate || []),
      ...(cfg?.ccm2Gate || []),
    ].filter(x => x?.date),
    getCurrent: cfg => {
      const all = [...(cfg?.ccm1Gate || []), ...(cfg?.ccm2Gate || [])].filter(x => x?.date);
      return all[all.length - 1]?.date || '';
    },
    setCurrent: (cfg, v) => ({
      ...cfg,
      ccm2Gate: v ? [{ label: 'Code Complete Met', date: v, color: '#de350b', style: 'solid' }] : [],
    }),
    stampReason: (cfg, r) => {
      const arr = cfg?.ccm2Gate?.length
        ? cfg.ccm2Gate
        : cfg?.ccm1Gate;
      if (!arr?.length) return cfg;
      const which = cfg?.ccm2Gate?.length ? 'ccm2Gate' : 'ccm1Gate';
      const updated = [...cfg[which]];
      updated[updated.length - 1] = { ...updated[updated.length - 1], reason: r };
      return { ...cfg, [which]: updated };
    },
  },
  {
    key: 'cg',
    label: 'CG',
    isGA: false,
    getAll: cfg => [cfg?.commitGate1, cfg?.commitGate2].filter(x => x?.date),
    getCurrent: cfg => cfg?.commitGate2?.date || cfg?.commitGate1?.date || '',
    setCurrent: (cfg, v) => {
      if (!cfg?.commitGate1?.date && !cfg?.commitGate2?.date) {
        return { ...cfg, commitGate1: v ? { label: 'Commit Gate', date: v, color: '#ff9800', style: 'solid' } : null };
      }
      if (cfg?.commitGate2?.date) {
        return { ...cfg, commitGate1: cfg.commitGate2, commitGate2: v ? { ...cfg.commitGate2, date: v, reason: undefined } : null };
      }
      return { ...cfg, commitGate2: v ? { label: 'Commit Gate', date: v, color: '#ff9800', style: 'solid' } : null };
    },
    stampReason: (cfg, r) => {
      const slot = cfg?.commitGate2?.date ? 'commitGate2' : 'commitGate1';
      return cfg?.[slot] ? { ...cfg, [slot]: { ...cfg[slot], reason: r } } : cfg;
    },
  },
  {
    key: 'pg',
    label: 'PG',
    isGA: false,
    getAll: cfg => [
      ...(cfg?.promotionGateOverflow || []),
      cfg?.promotionGate1,
      cfg?.promotionGate2,
      cfg?.promotionGate3,
    ].filter(x => x?.date),
    getCurrent: cfg => cfg?.promotionGate3?.date || cfg?.promotionGate2?.date || cfg?.promotionGate1?.date || '',
    setCurrent: (cfg, v) => {
      const slots = ['promotionGate1', 'promotionGate2', 'promotionGate3'];
      const last  = [...slots].reverse().find(k => cfg?.[k]?.date);
      if (!last) return { ...cfg, promotionGate1: v ? { label: 'Promotion Gate', date: v, color: '#9c27b0', style: 'solid' } : null };
      const idx  = slots.indexOf(last);
      const next = slots[Math.min(idx + 1, slots.length - 1)];
      if (next === last) {
        // All named slots full — push oldest into overflow (unlimited history), rotate, set newest
        const overflow = [...(cfg.promotionGateOverflow || []), cfg.promotionGate1].filter(x => x?.date);
        return {
          ...cfg,
          promotionGateOverflow: overflow,
          promotionGate1: cfg.promotionGate2,
          promotionGate2: cfg.promotionGate3,
          promotionGate3: v ? { ...(cfg.promotionGate3 || {}), date: v, reason: undefined } : null,
        };
      }
      return { ...cfg, [next]: v ? { label: 'Promotion Gate', date: v, color: '#9c27b0', style: 'solid' } : null };
    },
    stampReason: (cfg, r) => {
      const slot = ['promotionGate3','promotionGate2','promotionGate1'].find(k => cfg?.[k]?.date);
      return slot ? { ...cfg, [slot]: { ...cfg[slot], reason: r } } : cfg;
    },
  },
  {
    key: 'ga',
    label: 'GA',
    isGA: true,
    getAll: cfg => [
      ...(cfg?.gaOverflow || []),
      cfg?.ga1,
      cfg?.ga2,
      cfg?.ga3,
    ].filter(x => x?.date),
    getCurrent: cfg => cfg?.ga3?.date || cfg?.ga2?.date || cfg?.ga1?.date || '',
    setCurrent: (cfg, v) => {
      const slots = ['ga1', 'ga2', 'ga3'];
      const last  = [...slots].reverse().find(k => cfg?.[k]?.date);
      if (!last) return { ...cfg, ga1: v ? { label: 'GA', date: v, color: '#28a745', style: 'solid' } : null };
      const idx  = slots.indexOf(last);
      const next = slots[Math.min(idx + 1, slots.length - 1)];
      if (next === last) {
        // All named slots full — push oldest into overflow (unlimited history), rotate, set newest
        const overflow = [...(cfg.gaOverflow || []), cfg.ga1].filter(x => x?.date);
        return {
          ...cfg,
          gaOverflow: overflow,
          ga1: cfg.ga2,
          ga2: cfg.ga3,
          ga3: v ? { ...(cfg.ga3 || {}), date: v, reason: undefined } : null,
        };
      }
      return { ...cfg, [next]: v ? { label: 'GA', date: v, color: '#28a745', style: 'solid' } : null };
    },
    stampReason: (cfg, r) => {
      const slot = ['ga3','ga2','ga1'].find(k => cfg?.[k]?.date);
      return slot ? { ...cfg, [slot]: { ...cfg[slot], reason: r } } : cfg;
    },
  },
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

// ── Reasoning modal ───────────────────────────────────────────────────────────
function ReasonModal({ version, changedCols, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const hasGA = changedCols.some(c => c.isGA);
  return (
    <div className="modal-backdrop">
      <div className="modal-box">
        <h3>Why are these dates changing? — {version}</h3>
        <p className="modal-subtitle">Changed: {changedCols.map(c => c.label).join(', ')}.</p>
        {hasGA && (
          <p className="modal-warning">
            GA change will update JIRA (FEAT + ERA) and notify the team by email.
          </p>
        )}
        <textarea
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
  const [showNewForm, setShowNewForm]   = useState(false);
  const [newVersion, setNewVersion]     = useState('');
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/config/release-dates');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setReleases(data.releases || {});
    } catch (e) {
      setError('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

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

  function detectChangedCols(version) {
    const original = releases[version] || {};
    const edited   = pendingEdits[version] || {};
    return GATE_COLUMNS.filter(col => col.getCurrent(edited) !== col.getCurrent(original));
  }

  function requestSave(version) {
    const changed = detectChangedCols(version);
    if (!changed.length) { cancelEdit(version); return; }
    setShowModal({ version, changedCols: changed });
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
      setSuccess(`${version} saved.`);
    } catch (e) {
      setError('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveNewRelease() {
    if (!newVersion.trim()) { setError('Version is required'); return; }
    await doSave(newVersion.trim(), {}, '');
    setShowNewForm(false);
    setNewVersion('');
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
      setSuccess(`${version} deleted.`);
    } catch (e) {
      setError('Delete failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="rc-loading">Loading…</div>;

  const versions = Object.keys(releases);

  return (
    <div className="rc-page">
      <div className="rc-header">
        <div>
          <h1>Release Configuration</h1>
          <p>Struck-out dates show previous revisions with their reasons. GA changes update JIRA and notify the team.</p>
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
                    <td className="col-version">{version}</td>

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

                    <td className="col-actions">
                      {editing ? (
                        <>
                          <button className="btn-save"   onClick={() => requestSave(version)} disabled={saving}>Save</button>
                          <button className="btn-cancel" onClick={() => cancelEdit(version)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="btn-edit"   onClick={() => startEdit(version)}>Edit</button>
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

      {error   && <Toast message={error}   type="error"   onClose={() => setError('')}   />}
      {success && <Toast message={success} type="success" onClose={() => setSuccess('')} />}

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

        .col-version { font-weight: 600; min-width: 90px; white-space: nowrap; }
        .col-ga      { background: rgba(40,167,69,0.04); }
        .col-actions { min-width: 104px; white-space: nowrap; }
        .date-cell   { min-width: 80px; }

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
