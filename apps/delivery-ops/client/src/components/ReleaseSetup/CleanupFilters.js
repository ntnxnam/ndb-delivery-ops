import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedPost, authenticatedGet } from '../../utils/api';
import { statusLabel, statusColor, statusIcon, cardStyle, sectionHeading } from './shared';

function CleanupFilters() {
  const [versionsInput, setVersionsInput] = useState('');
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  // Prefill versions input from releaseBaseFilters config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authenticatedGet('/api/config/release-versions-columns', {}, { jiraToken, username });
        if (cancelled) return;
        const map = res.data?.releaseBaseFilters || {};
        const keys = Object.keys(map);
        if (keys.length) setVersionsInput(keys.join(', '));
      } catch (_) {
        // Best-effort prefill; user can type manually
      } finally {
        if (!cancelled) setDefaultsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [jiraToken, username]);

  const parseVersions = () => versionsInput
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const runCleanup = useCallback(async (dryRun) => {
    if (!jiraToken) {
      setError('JIRA token not found. Please log out and log back in.');
      return;
    }
    const versions = parseVersions();
    if (!versions.length) {
      setError('Enter at least one version to scan.');
      return;
    }
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await authenticatedPost('/api/jira/cleanup-duplicate-prefix-filters', {
        versions,
        dryRun: !!dryRun,
      }, { jiraToken, username });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionsInput, jiraToken, username]);

  return (
    <div>
      <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>
        Find saved filters created with the duplicate <code>GetNDB&lt;NDB-x.y&gt;...</code> prefix bug
        and rename them to the correct <code>Get&lt;NDB-x.y&gt;...</code> form. Filter JQL bodies are
        regenerated so dependent filters keep working.
      </p>

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>Versions to Scan</h3>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>
          Comma-separated list (defaults from releaseBaseFilters)
        </label>
        <input
          type="text"
          value={versionsInput}
          onChange={e => { setVersionsInput(e.target.value); setResult(null); }}
          placeholder="NDB-3.0, NDB-3.1"
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem', marginBottom: 12 }}
          disabled={!defaultsLoaded}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => runCleanup(true)}
            disabled={loading || !defaultsLoaded}
            style={{
              padding: '7px 16px',
              backgroundColor: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontSize: '0.85rem',
            }}
          >
            {loading ? 'Scanning\u2026' : 'Scan (Dry Run)'}
          </button>
          <button
            onClick={() => runCleanup(false)}
            disabled={loading || !defaultsLoaded}
            style={{
              padding: '7px 16px',
              backgroundColor: '#dc3545',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontSize: '0.85rem',
            }}
          >
            {loading ? 'Renaming\u2026' : 'Rename All'}
          </button>
        </div>
        {error && <div style={{ color: '#dc3545', fontSize: '0.82rem', marginTop: 8 }}>{error}</div>}
      </div>

      {result?.results?.length > 0 && (
        <>
          <div style={sectionHeading}>Results {result.dryRun && <em style={{ fontSize: '0.8rem', color: '#856404' }}>(dry run - no changes made)</em>}</div>
          {result.results.map(versionResult => (
            <div key={versionResult.version} style={cardStyle}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>{versionResult.version}</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Bad name</th>
                    <th style={thStyle}>Correct name</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {versionResult.filters.map(f => (
                    <tr key={f.order}>
                      <td style={tdStyle}>{f.order}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{f.badName}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{f.correctName}</td>
                      <td style={{ ...tdStyle, color: statusColor(f.status) }}>
                        {statusIcon(f.status)} {statusLabel(f.status)}
                        {f.error && <div style={{ color: '#dc3545', fontSize: '0.75rem' }}>{f.error}</div>}
                      </td>
                    </tr>
                  ))}
                  {versionResult.allFilter && (
                    <tr>
                      <td style={tdStyle}>-All</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }} colSpan={2}>{versionResult.allFilter.name}</td>
                      <td style={{ ...tdStyle, color: statusColor(versionResult.allFilter.status) }}>
                        {statusIcon(versionResult.allFilter.status)} {statusLabel(versionResult.allFilter.status)}
                        {versionResult.allFilter.error && <div style={{ color: '#dc3545', fontSize: '0.75rem' }}>{versionResult.allFilter.error}</div>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #ddd', fontWeight: 600 };
const tdStyle = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' };

export default CleanupFilters;
