import React from 'react';
import { useJqlBuilder } from '../../hooks/useJqlBuilder';
import './JqlBuilder.css';

const JIRA_BASE = process.env.REACT_APP_JIRA_BASE_URL || 'https://jira.nutanix.com';

export default function JqlBuilder({ teamId, releaseVersion }) {
  const { plaintext, result, loading, testResult, onChange, test } = useJqlBuilder();
  const jql = result?.jql || '';

  return (
    <section className="ds-section jql-builder">
      <h3 className="ds-section-title">JQL Builder</h3>
      <textarea className="ds-input jql-builder-input" value={plaintext} onChange={e => onChange(e.target.value, teamId, releaseVersion)} placeholder="e.g. all P0s from code complete to today that weren&apos;t QA verified" rows={3} />
      {loading && <span className="ds-badge">Generating…</span>}
      {result && (
        <div className="ds-card jql-builder-card">
          <div className="jql-builder-jql">{jql || '—'}</div>
          {result.cited && <div className="ds-caption">from: “{result.cited.plaintext}” @ {result.cited.timestamp}</div>}
          <div className="jql-builder-tokens">{(result.tokens || []).map((t, i) => <span key={i} className={`ds-pill ds-pill--${t.type === 'knownField' ? 'success' : t.type === 'assumed' ? 'warning' : 'danger'}`}>{t.text}</span>)}</div>
          {!!(result.warnings || []).length && <ul className="jql-builder-warnings">{result.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
          <div className="jql-builder-actions">
            <button className="ds-btn ds-btn--secondary" type="button" onClick={() => test(jql)}>Test</button>
            <a className="ds-btn ds-btn--secondary" href={`${JIRA_BASE}/issues/?jql=${encodeURIComponent(jql)}`} target="_blank" rel="noreferrer">Open in Jira</a>
            <button className="ds-btn ds-btn--ghost" type="button" disabled title="Stub">Save as KPI</button>
            <a className="ds-btn ds-btn--ghost" href="/schedules">Save as Schedule</a>
          </div>
          {testResult && <div className="ds-caption">{testResult.ok ? `Count: ${testResult.total}` : `Error: ${testResult.error}`}{testResult.warning ? ` (${testResult.warning})` : ''}</div>}
        </div>
      )}
    </section>
  );
}
