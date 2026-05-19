import React, { useState, useMemo, useCallback } from 'react';
import { authenticatedPost } from '../../utils/api';
import { generateFilterChain, RELEASE_PROJECTS, isValidVersionName } from '../../utils/jqlTemplates';
import { statusLabel, statusColor, statusIcon, cardStyle, sectionHeading } from './shared';

function RenameRelease() {
  const [oldVersion, setOldVersion] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [excludeVersion, setExcludeVersion] = useState('');
  const [selectedProjects, setSelectedProjects] = useState(RELEASE_PROJECTS);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const previewChain = useMemo(() => {
    if (!isValidVersionName(oldVersion) || !isValidVersionName(newVersion)) return null;
    return {
      oldChain: generateFilterChain(oldVersion, excludeVersion),
      newChain: generateFilterChain(newVersion, excludeVersion),
    };
  }, [oldVersion, newVersion, excludeVersion]);

  const canSubmit = isValidVersionName(oldVersion)
    && isValidVersionName(newVersion)
    && oldVersion.trim() !== newVersion.trim()
    && selectedProjects.length > 0
    && !loading;

  const runCascade = useCallback(async (dryRun) => {
    if (!jiraToken) {
      setError('JIRA token not found. Please log out and log back in.');
      return;
    }
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await authenticatedPost('/api/jira/rename-release-cascade', {
        oldVersion: oldVersion.trim(),
        newVersion: newVersion.trim(),
        excludeVersion: excludeVersion.trim() || undefined,
        projects: selectedProjects,
        dryRun: !!dryRun,
      }, { jiraToken, username });
      setResult(res.data);
    } catch (err) {
      const data = err.response?.data || {};
      if (data.conflicts) {
        setError(`${data.error}: ${data.conflicts.map(c => c.newName).join(', ')}`);
      } else {
        setError(data.error || err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [oldVersion, newVersion, excludeVersion, selectedProjects, jiraToken, username]);

  const toggleProject = (proj) => {
    setSelectedProjects(prev => prev.includes(proj) ? prev.filter(p => p !== proj) : [...prev, proj]);
  };

  return (
    <div>
      <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>
        Rename a release end-to-end: fixVersions in all selected projects, the 5 saved filters in the chain,
        and the release base filter config entry. Filter JQL bodies are regenerated so cross-references stay valid.
      </p>

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>Inputs</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Old Version Name</label>
            <input
              type="text"
              value={oldVersion}
              onChange={e => { setOldVersion(e.target.value); setResult(null); }}
              placeholder="NDB-3.0"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>New Version Name</label>
            <input
              type="text"
              value={newVersion}
              onChange={e => { setNewVersion(e.target.value); setResult(null); }}
              placeholder="NDB-3.1"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Exclude Version (for root filter)</label>
            <input
              type="text"
              value={excludeVersion}
              onChange={e => { setExcludeVersion(e.target.value); setResult(null); }}
              placeholder="optional"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Projects</label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {RELEASE_PROJECTS.map(p => (
              <label key={p} style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedProjects.includes(p)}
                  onChange={() => toggleProject(p)}
                  style={{ marginRight: 5 }}
                />
                {p}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => runCascade(true)}
            disabled={!canSubmit}
            style={{
              padding: '7px 16px',
              backgroundColor: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.6,
              fontSize: '0.85rem',
            }}
          >
            {loading ? 'Running\u2026' : 'Dry Run'}
          </button>
          <button
            onClick={() => runCascade(false)}
            disabled={!canSubmit}
            style={{
              padding: '7px 16px',
              backgroundColor: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.6,
              fontSize: '0.85rem',
            }}
          >
            {loading ? 'Running\u2026' : 'Confirm Rename'}
          </button>
        </div>
        {error && <div style={{ color: '#dc3545', fontSize: '0.82rem', marginTop: 8 }}>{error}</div>}
      </div>

      {previewChain && (
        <>
          <div style={sectionHeading}>Preview</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Old name</th>
                <th style={thStyle}>New name</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedProjects.map(p => {
                const row = (result?.versions || []).find(v => v.projectKey === p);
                return (
                  <tr key={`v-${p}`}>
                    <td style={tdStyle}><em style={{ color: '#888' }}>{p}</em></td>
                    <td style={tdStyle}>{oldVersion}</td>
                    <td style={tdStyle}>{newVersion}</td>
                    <td style={{ ...tdStyle, color: statusColor(row?.status) }}>
                      {row ? `${statusIcon(row.status)} ${statusLabel(row.status)}` : '\u2014'}
                      {row?.error && <div style={{ color: '#dc3545', fontSize: '0.75rem' }}>{row.error}</div>}
                    </td>
                  </tr>
                );
              })}
              {previewChain.oldChain.map((f, i) => {
                const row = (result?.filters || []).find(r => r.order === f.order);
                return (
                  <tr key={`f-${f.order}`}>
                    <td style={tdStyle}>{f.order}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{f.name}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{previewChain.newChain[i].name}</td>
                    <td style={{ ...tdStyle, color: statusColor(row?.status) }}>
                      {row ? `${statusIcon(row.status)} ${statusLabel(row.status)}` : '\u2014'}
                      {row?.error && <div style={{ color: '#dc3545', fontSize: '0.75rem' }}>{row.error}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result?.config && (
            <div style={{ ...cardStyle, marginTop: 12, background: result.config.updated ? '#d4edda' : '#fff3cd', borderColor: result.config.updated ? '#28a745' : '#ffc107' }}>
              <strong style={{ fontSize: '0.85rem' }}>Config:</strong>
              <span style={{ fontSize: '0.82rem', marginLeft: 6 }}>
                {result.config.updated
                  ? `releaseBaseFilters[${result.config.newKey}] = ${result.config.value}`
                  : (result.dryRun
                      ? `Will set releaseBaseFilters[${result.config.newKey}] = ${result.config.plannedValue}`
                      : `Config update failed: ${result.config.error || 'unknown'}`)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #ddd', fontWeight: 600 };
const tdStyle = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' };

export default RenameRelease;
