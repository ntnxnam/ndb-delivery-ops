import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PageLoading } from '../../shared/components/PageLoading';
import { useTeamAdmin } from '../../hooks/useTeamAdmin';
import {
  authenticatedGet,
  authenticatedPut,
  authenticatedDelete,
  authenticatedPost,
} from '../../shared/services/apiService';
import { adminAuth } from '../../hooks/useTeamAdmin';
import './ConfigManager.css';

const GROUP_LABELS = {
  oncall: 'OnCall',
  cfdcfi: 'CFD / CFI',
  jira: 'JIRA',
  general: 'General',
  teams: 'Teams',
  email: 'Email',
};

function groupOrder(group) {
  const order = { oncall: 0, cfdcfi: 1, jira: 2, general: 3, teams: 4, email: 5 };
  return order[group] ?? 99;
}

function flattenForPreview(obj, prefix = '', out = []) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out.push({ path: prefix || '(root)', value: obj });
    return out;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    out.push({ path: prefix || '(root)', value: obj });
    return out;
  }
  for (const k of keys) {
    const full = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      flattenForPreview(v, full, out);
    } else {
      out.push({ path: full, value: v });
    }
  }
  return out;
}

function parseJsonLoose(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default function ConfigManager() {
  const { adminAuth: _unused } = { adminAuth: null }; // keep hook dep stable if needed
  const adminHook = useTeamAdmin(); // reuses adminAuth helper shape
  void adminHook;

  const [configs, setConfigs] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedKey, setSelectedKey] = useState('oncall');
  const [configData, setConfigData] = useState(null);
  const [configMeta, setConfigMeta] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'success'|'error', text }
  const [jsonText, setJsonText] = useState('');
  const [jsonDirty, setJsonDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add-field form
  const [newFieldPath, setNewFieldPath] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [addingField, setAddingField] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const res = await authenticatedGet('/api/admin/configs', {}, adminAuth());
      const list = res.data?.configs || [];
      setConfigs(list);
      if (list.length && !list.find((c) => c.key === selectedKey)) {
        setSelectedKey(list[0].key);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Failed to load configs';
      setListError(msg);
    } finally {
      setLoadingList(false);
    }
  }, [selectedKey]);

  const loadConfig = useCallback(async (key) => {
    if (!key) return;
    setLoadingConfig(true);
    setConfigError('');
    setNotice(null);
    try {
      const res = await authenticatedGet(`/api/admin/configs/${encodeURIComponent(key)}`, {}, adminAuth());
      setConfigData(res.data?.data ?? null);
      setConfigMeta({ key: res.data?.key, file: res.data?.file, label: res.data?.label, description: res.data?.description });
      setJsonText(JSON.stringify(res.data?.data ?? {}, null, 2));
      setJsonDirty(false);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Failed to load config';
      setConfigError(msg);
      setConfigData(null);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadConfig(selectedKey); }, [selectedKey, loadConfig]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const grouped = useMemo(() => {
    const g = {};
    for (const c of configs) {
      const grp = c.group || 'general';
      if (!g[grp]) g[grp] = [];
      g[grp].push(c);
    }
    return Object.entries(g).sort((a, b) => groupOrder(a[0]) - groupOrder(b[0]));
  }, [configs]);

  const handleSave = async () => {
    const parsed = parseJsonLoose(jsonText);
    if (!parsed.ok) {
      setNotice({ type: 'error', text: `Invalid JSON: ${parsed.error}` });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await authenticatedPut(`/api/admin/configs/${encodeURIComponent(selectedKey)}`, { data: parsed.value }, adminAuth());
      setConfigData(res.data?.data ?? parsed.value);
      setJsonText(JSON.stringify(res.data?.data ?? parsed.value, null, 2));
      setJsonDirty(false);
      setNotice({ type: 'success', text: res.data?.message || 'Saved.' });
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Save failed';
      setNotice({ type: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = async () => {
    const path = newFieldPath.trim();
    if (!path) {
      setNotice({ type: 'error', text: 'Field path is required (e.g. customFields.myFlag or slaThresholds.p0Hours).' });
      return;
    }
    let value;
    const raw = newFieldValue.trim();
    if (raw === '') {
      value = '';
    } else {
      const parsed = parseJsonLoose(raw);
      // If it parses as JSON, use parsed value; otherwise treat as string
      value = parsed.ok ? parsed.value : raw;
      // If raw was a plain string without quotes that parsed as error, keep raw string
      if (!parsed.ok && raw.length > 0) value = raw;
    }
    setAddingField(true);
    try {
      const res = await authenticatedPost(`/api/admin/configs/${encodeURIComponent(selectedKey)}/field`, { fieldPath: path, value }, adminAuth());
      setConfigData(res.data?.data ?? null);
      setJsonText(JSON.stringify(res.data?.data ?? {}, null, 2));
      setJsonDirty(false);
      setNotice({ type: 'success', text: res.data?.message || `Field "${path}" added.` });
      setNewFieldPath('');
      setNewFieldValue('');
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Add field failed';
      setNotice({ type: 'error', text: msg });
    } finally {
      setAddingField(false);
    }
  };

  const handleDeleteField = async (fieldPath) => {
    if (!window.confirm(`Remove field "${fieldPath}"? This writes the config file immediately.`)) return;
    try {
      const res = await authenticatedDelete(`/api/admin/configs/${encodeURIComponent(selectedKey)}/field`, { fieldPath }, adminAuth());
      setConfigData(res.data?.data ?? null);
      setJsonText(JSON.stringify(res.data?.data ?? {}, null, 2));
      setJsonDirty(false);
      setNotice({ type: 'success', text: res.data?.message || `Field "${fieldPath}" removed.` });
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Delete failed';
      setNotice({ type: 'error', text: msg });
    }
  };

  const onJsonChange = (e) => {
    setJsonText(e.target.value);
    setJsonDirty(true);
  };

  const selectedLabel = configMeta?.label || configs.find((c) => c.key === selectedKey)?.label || selectedKey;

  if (loadingList) return <PageLoading message="Loading configs…" />;
  if (listError) {
    return (
      <div className="config-manager">
        <div className="config-manager__notice config-manager__notice--error">{listError}</div>
      </div>
    );
  }

  return (
    <div className="config-manager">
      <div className="config-manager__header">
        <div>
          <h1 className="config-manager__title">Config Manager</h1>
          <p className="config-manager__subtitle">
            Super-admin only. Edit allowlisted JSON configs without a deploy. Changes write the file and create a <code>.bak</code> backup. For OnCall / CFD / CFI you can add custom fields here instead of going via backend.
          </p>
        </div>
      </div>

      <div className="config-manager__layout">
        <nav className="config-manager__nav" aria-label="Config files">
          {grouped.map(([group, items]) => (
            <div key={group}>
              <div className="config-manager__nav-group">{GROUP_LABELS[group] || group}</div>
              {items.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`config-manager__nav-item ${c.key === selectedKey ? 'config-manager__nav-item--active' : ''}`}
                  onClick={() => setSelectedKey(c.key)}
                  title={c.description}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="config-manager__panel">
          <div className="config-manager__panel-head">
            <div>
              <h2 className="config-manager__panel-title">{selectedLabel}</h2>
              {configMeta && (
                <div className="config-manager__panel-meta">
                  <code>{configMeta.file}</code>
                  {configMeta.description ? ` — ${configMeta.description}` : ''}
                </div>
              )}
            </div>
            <div className="config-manager__actions">
              <button type="button" className="config-manager__btn config-manager__btn--secondary" onClick={() => loadConfig(selectedKey)} disabled={loadingConfig}>
                Reload
              </button>
              <button type="button" className="config-manager__btn config-manager__btn--primary" onClick={handleSave} disabled={saving || !jsonDirty}>
                {saving ? 'Saving…' : 'Save JSON'}
              </button>
            </div>
          </div>

          {notice && (
            <div className={`config-manager__notice config-manager__notice--${notice.type}`} role="status">
              {notice.text}
            </div>
          )}
          {configError && (
            <div className="config-manager__notice config-manager__notice--error">{configError}</div>
          )}

          {loadingConfig ? (
            <div style={{ padding: 24, color: '#6b7280' }}>Loading…</div>
          ) : (
            <>
              <textarea
                className="config-manager__json-area"
                value={jsonText}
                onChange={onJsonChange}
                spellCheck={false}
                aria-label="Config JSON"
                placeholder="{}"
              />
              <div className="config-manager__hint">
                Edit the JSON above and click <strong>Save JSON</strong>. Or use <strong>Add field</strong> below to insert a single key without touching the rest of the file.
              </div>

              <div className="config-manager__add-field">
                <input
                  className="config-manager__input"
                  placeholder='Field path, e.g. customFields.myFlag or slaThresholds.p0Hours'
                  value={newFieldPath}
                  onChange={(e) => setNewFieldPath(e.target.value)}
                />
                <input
                  className="config-manager__input"
                  placeholder='Value as JSON (e.g. 42, true, "hello", ["a","b"]) or plain text'
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                />
                <button type="button" className="config-manager__btn config-manager__btn--primary" onClick={handleAddField} disabled={addingField}>
                  {addingField ? 'Adding…' : 'Add / Update field'}
                </button>
              </div>

              {configData && typeof configData === 'object' && (
                <div style={{ borderTop: '1px solid #e5e7eb' }}>
                  <div style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#6b7280', background: '#f9fafb' }}>
                    Quick remove — click × to delete a leaf field (writes file):
                  </div>
                  {flattenForPreview(configData).slice(0, 80).map(({ path: p, value: v }) => (
                    <div key={p} className="config-manager__field-row">
                      <span className="config-manager__field-label">{p}</span>
                      <span className="config-manager__field-value">{Array.isArray(v) ? `[${v.length}] ${JSON.stringify(v).slice(0, 120)}` : typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 120) : String(v)}</span>
                      <button type="button" className="config-manager__btn config-manager__btn--danger" onClick={() => handleDeleteField(p)} title={`Remove ${p}`}>
                        ×
                      </button>
                    </div>
                  ))}
                  {flattenForPreview(configData).length > 80 && (
                    <div className="config-manager__hint">Showing first 80 leaf fields — use the JSON editor for deeper edits.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
