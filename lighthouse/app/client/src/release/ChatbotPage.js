import React, { useRef, useState } from 'react';
import { useChat } from '../hooks/useChat';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
import { useJqlAutocomplete } from '../hooks/useJqlAutocomplete';
import { ENABLE_JIRA_DIGGING, ENABLE_JQL_AUTOCOMPLETE } from '../config/featureFlags';
import { authenticatedPost } from '../shared/services/apiService';
import './ChatbotPage.css';

function linkifyTicketKeys(text) {
  const jiraBase = 'https://jira.nutanix.com/browse/';
  const parts = [];
  const regex = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const key = match[1];
    parts.push(
      <a key={`${key}-${match.index}`} href={`${jiraBase}${key}`} target="_blank" rel="noreferrer">
        {key}
      </a>
    );
    last = match.index + key.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function ChatbotPage() {
  const { selectedRelease, setSelectedRelease, activeVersions, inactiveVersions, productId } = useSelectedRelease();
  const { messages, loading, error, scope, sendMessage, clearChat, decideApproval } = useChat();
  const [prompt, setPrompt] = useState('');
  const [chatMode, setChatMode] = useState('active');
  const [diggingJql, setDiggingJql] = useState('');
  const [diggingDrawerOpen, setDiggingDrawerOpen] = useState(false);
  const [diggingDataset, setDiggingDataset] = useState(null);
  const [diggingLoading, setDiggingLoading] = useState(false);
  const jqlRef = useRef(null);
  const promptRef = useRef(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTickets, setDrillTickets] = useState(null);
  // D1: labelPrefix defaults to productId (productService.getLabelPrefix fallback);
  // release drives versioned label suggestions like `${labelPrefix}-${release}-deferred`.
  const jqlAuto = useJqlAutocomplete({ labelPrefix: productId || undefined, release: selectedRelease || undefined });
  const [jqlShowSuggest, setJqlShowSuggest] = useState(false);

  const allVersions = [...(activeVersions || []), ...(inactiveVersions || [])];

  const onSubmit = async (e) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || loading) return;
    // Digging: require dataset, else nudge; pass datasetId/jqlHash to POST /api/ai/chat
    if (chatMode === 'digging') {
      if (!ENABLE_JIRA_DIGGING) return;
      if (!diggingDataset?.id) {
        // No dataset yet — do not call sendMessage; let scope hint guide user
        return;
      }
      setPrompt('');
      await sendMessage(text, {
        datasetId: diggingDataset.id,
        jqlHash: diggingDataset.jqlHash,
        productId: diggingDataset.productId || undefined,
      });
      return;
    }
    setPrompt('');
    await sendMessage(text);
  };

  // Slice 3: dedicated Ask handler for digging (used if Ask button added separately)
  const handleDiggingAsk = async (question) => {
    const q = String(question || prompt).trim();
    if (!q || loading || !diggingDataset?.id) return;
    setPrompt('');
    await sendMessage(q, {
      datasetId: diggingDataset.id,
      jqlHash: diggingDataset.jqlHash,
      productId: diggingDataset.productId || undefined,
    });
  };

  // Slice 2: live JIRA via POST /api/jira-digging/prepare (searchCount + sample) — PAT from localStorage via authenticatedPost
  const [diggingError, setDiggingError] = useState('');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [includeComments, setIncludeComments] = useState(false);
  const handleDiggingFetch = async () => {
    const jql = diggingJql.trim();
    if (!jql) return;
    if (!ENABLE_JIRA_DIGGING) { setDiggingError('Custom JQL Digging is disabled by feature flag (REACT_APP_ENABLE_JIRA_DIGGING=false)'); return; }
    setDiggingLoading(true);
    setDiggingError('');
    try {
      // Product-agnostic D1: pass productId so cache is per-product (no hardcoded product)
      const resp = await authenticatedPost('/api/jira-digging/prepare', { jql, productId: productId || 'ndb', includeHistory, includeComments });
      const data = resp?.data || {};
      if (data.error) throw new Error(data.error);
      setDiggingDataset({
        id: data.datasetId,
        jql: data.jql || jql,
        ticketCount: data.ticketCount,
        sampleKeys: data.sampleKeys || [],
        fetchedAt: data.fetchedAt,
        status: data.mode === 'cached-full' ? 'cached' : 'live',
        truncated: data.truncated,
        includeHistory: data.includeHistory,
        includeComments: data.includeComments,
        jqlHash: data.jqlHash,
        productId: data.productId || productId || 'ndb',
      });
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Fetch failed';
      setDiggingError(msg);
      setDiggingDataset(null);
    } finally {
      setDiggingLoading(false);
    }
  };

  const handleModeChange = (mode) => {
    if (mode === 'digging' && !ENABLE_JIRA_DIGGING) return;
    setChatMode(mode);
    if (mode === 'digging') setDiggingDrawerOpen(true);
  };

  return (
    <div className="chatbot-page">
      <div className="chatbot-header">
        <div>
          <h1>AI Chatbot</h1>
          <p>
            {chatMode === 'digging'
              ? 'Custom JQL Digging — fetch your ticket set once, then ask natural-language questions; answers cite tickets from that set.'
              : 'Ask release, ticket, and risk questions grounded in cached release context.'}
          </p>
        </div>
        <div className="chatbot-controls">
          <div className="chatbot-mode-toggle" role="group" aria-label="Chat mode">
            <button
              type="button"
              className={`chatbot-mode-btn ${chatMode === 'active' ? 'active' : ''}`}
              onClick={() => handleModeChange('active')}
            >
              Active Releases
            </button>
            <button
              type="button"
              className={`chatbot-mode-btn ${chatMode === 'digging' ? 'active' : ''}`}
              onClick={() => handleModeChange('digging')}
              disabled={!ENABLE_JIRA_DIGGING}
              title={ENABLE_JIRA_DIGGING ? '' : 'Disabled by REACT_APP_ENABLE_JIRA_DIGGING=false'}
            >
              Custom JQL Digging {!ENABLE_JIRA_DIGGING && '(off)'}
            </button>
          </div>
          {chatMode === 'active' && (
            <select
              className="chatbot-release-select"
              value={selectedRelease || ''}
              onChange={(e) => setSelectedRelease(e.target.value)}
            >
              {allVersions.map((v) => {
                const name = typeof v === 'string' ? v : v.name;
                return (
                  <option key={name} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          )}
          {chatMode === 'digging' && (
            <button
              type="button"
              className="chatbot-clear-btn"
              onClick={() => setDiggingDrawerOpen((v) => !v)}
            >
              {diggingDrawerOpen ? 'Hide JQL' : 'Show JQL'}
            </button>
          )}
          <button type="button" onClick={clearChat} className="chatbot-clear-btn">
            Clear
          </button>
        </div>
      </div>

      {chatMode === 'digging' && diggingDrawerOpen && (
        <div className="chatbot-digging-drawer">
          <div className="chatbot-digging-row">
            <label className="chatbot-digging-label" htmlFor="digging-jql">Base JQL</label>
            <span className="chatbot-digging-hint">Tip: Fetch once → Ask grounded. Your set is cached until you Clear dataset. Tab to accept a suggestion.</span>
          </div>
          <div className="chatbot-jql-wrap">
            <textarea
              id="digging-jql"
              ref={jqlRef}
              className="chatbot-digging-textarea"
              value={diggingJql}
              onChange={(e) => {
                const v = e.target.value;
                const c = e.target.selectionStart ?? v.length;
                setDiggingJql(v);
                if (ENABLE_JQL_AUTOCOMPLETE) {
                  jqlAuto.compute(v, c);
                  setJqlShowSuggest(true);
                }
              }}
              onSelect={(e) => {
                if (!ENABLE_JQL_AUTOCOMPLETE) return;
                jqlAuto.compute(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (!ENABLE_JQL_AUTOCOMPLETE || !jqlShowSuggest || jqlAuto.suggestions.length === 0) {
                  if (e.key === 'Tab' && ENABLE_JQL_AUTOCOMPLETE && jqlAuto.ghost) {
                    e.preventDefault();
                    const res = jqlAuto.accept(diggingJql, jqlRef.current?.selectionStart ?? diggingJql.length, 0);
                    if (res) { setDiggingJql(res.nextText); requestAnimationFrame(() => jqlRef.current?.setSelectionRange(res.nextCaret, res.nextCaret)); }
                  }
                  return;
                }
                if (e.key === 'ArrowDown') { e.preventDefault(); jqlAuto.setActiveIndex((i) => (i + 1) % jqlAuto.suggestions.length); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); jqlAuto.setActiveIndex((i) => (i - 1 + jqlAuto.suggestions.length) % jqlAuto.suggestions.length); }
                else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  const res = jqlAuto.accept(diggingJql, jqlRef.current?.selectionStart ?? diggingJql.length);
                  if (res) { setDiggingJql(res.nextText); setJqlShowSuggest(false); requestAnimationFrame(() => jqlRef.current?.setSelectionRange(res.nextCaret, res.nextCaret)); }
                } else if (e.key === 'Escape') setJqlShowSuggest(false);
              }}
              onBlur={() => window.setTimeout(() => setJqlShowSuggest(false), 150)}
              onFocus={(e) => { if (ENABLE_JQL_AUTOCOMPLETE) { jqlAuto.compute(e.target.value, e.target.selectionStart ?? e.target.value.length); setJqlShowSuggest(true); } }}
              placeholder='e.g. project = ERA AND fixVersion = "NDB-2.11" AND issuetype in (Bug, Task) AND status != Closed'
              rows={3}
            />
            {ENABLE_JQL_AUTOCOMPLETE && jqlAuto.ghost && (
              <div className="chatbot-jql-ghost" aria-hidden>{diggingJql}<span>{jqlAuto.ghost}</span> <em>Tab to accept</em></div>
            )}
            {ENABLE_JQL_AUTOCOMPLETE && jqlShowSuggest && jqlAuto.suggestions.length > 0 && (
              <ul className="chatbot-jql-suggest">
                {jqlAuto.suggestions.map((s, idx) => (
                  <li key={`${s.kind}-${s.label}-${idx}`} className={idx === jqlAuto.activeIndex ? 'active' : ''} onMouseDown={(ev) => { ev.preventDefault(); const res = jqlAuto.accept(diggingJql, jqlRef.current?.selectionStart ?? diggingJql.length, idx); if (res) { setDiggingJql(res.nextText); setJqlShowSuggest(false); requestAnimationFrame(() => jqlRef.current?.setSelectionRange(res.nextCaret, res.nextCaret)); } }}>
                    <span className={`chatbot-jql-kind ${s.kind}`}>{s.kind}</span> {s.label}
                  </li>
                ))}
              </ul>
            )}
            {!ENABLE_JQL_AUTOCOMPLETE && <div className="chatbot-jql-flag-off">Autocomplete off — set REACT_APP_ENABLE_JQL_AUTOCOMPLETE=true and rebuild to enable.</div>}
          </div>
          <div className="chatbot-digging-actions">
            <div className="chatbot-digging-presets">
              <button type="button" onClick={() => setDiggingJql('project = ERA AND fixVersion = "NDB-2.11" AND status != Closed')}>NDB open</button>
              <button type="button" onClick={() => setDiggingJql('issuetype = Bug AND priority in (P0, P1) AND status not in (Closed, Resolved)')}>P0/P1 bugs</button>
              <button type="button" onClick={() => setDiggingJql('project = ERA AND updated >= -7d')}>Updated 7d</button>
            </div>
            <label className="chatbot-digging-toggle"><input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} /> History</label>
            <label className="chatbot-digging-toggle"><input type="checkbox" checked={includeComments} onChange={(e) => setIncludeComments(e.target.checked)} /> Comments</label>
            <button
              type="button"
              className="chatbot-digging-fetch"
              onClick={handleDiggingFetch}
              disabled={!diggingJql.trim() || diggingLoading}
            >
              {diggingLoading ? 'Fetching…' : 'Fetch & Index'}
            </button>
          </div>
          {(includeHistory || includeComments) && <div className="chatbot-digging-hint">History/comments make each ticket richer — slower beyond 500 tickets. Uncheck for fast fetch.</div>}
          {diggingError && <div className="chatbot-error">{diggingError}</div>}
          {diggingDataset && (
            <div className="chatbot-digging-card">
              <strong>{diggingDataset.status === 'cached' ? 'Cached dataset' : diggingDataset.status === 'live' ? 'Live dataset' : 'Mock dataset'}</strong> · <span onClick={async () => { setDrillOpen(v => !v); if (!drillTickets && diggingDataset?.jqlHash) { try { const r = await authenticatedPost('/api/jira-digging/dataset', { productId: diggingDataset.productId, jqlHash: diggingDataset.jqlHash }); setDrillTickets((r.data?.tickets || []).slice(0,20)); } catch {} } }} style={{ cursor: 'pointer', textDecoration: 'underline' }} title="In-app drill: preview tickets">{diggingDataset.ticketCount} tickets</span> · fetched {new Date(diggingDataset.fetchedAt).toLocaleTimeString()} · <a href={`https://jira.nutanix.com/issues/?jql=${encodeURIComponent(diggingDataset.jql)}`} target="_blank" rel="noreferrer">Open in JIRA ({diggingDataset.ticketCount})</a>
              <div className="chatbot-digging-jql">{diggingDataset.jql}</div>
              {diggingDataset.sampleKeys?.length > 0 && (
                <div className="chatbot-digging-sample">Sample: {diggingDataset.sampleKeys.map((k, i) => <span key={k}>{i > 0 ? ', ' : ''}<a href={`https://jira.nutanix.com/browse/${k}`} target="_blank" rel="noreferrer">{k}</a></span>)}{diggingDataset.truncated ? '…' : ''}</div>
              )}
              <span className="chatbot-digging-badge">
                Ready · {diggingDataset.ticketCount} tickets · History: {diggingDataset.includeHistory ? 'on' : 'off'} · Comments: {diggingDataset.includeComments ? 'on' : 'off'}
              </span>
              {drillOpen && (
                <div className="chatbot-drill-panel">
                  <strong>Preview — {drillTickets ? drillTickets.length : 0} of {diggingDataset.ticketCount}</strong>
                  {drillTickets ? <ul>{drillTickets.map(t => <li key={t.key}><a href={`https://jira.nutanix.com/browse/${t.key}`} target="_blank" rel="noreferrer">{t.key}</a> — {String(t.fields?.summary || t.summary || '').slice(0,80)}</li>)}</ul> : <div>Loading…</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {chatMode === 'active' && scope && (
        <div className="chatbot-scope">
          <strong>Scope:</strong> {scope.intent} · releases: {(scope.releases || []).join(', ') || 'none'} ·
          keys: {(scope.ticketKeys || []).join(', ') || 'none'}
        </div>
      )}
      {chatMode === 'digging' && diggingDataset && (
        <div className="chatbot-scope">
          <strong>Dataset:</strong> {diggingDataset.jql} · tickets: {diggingDataset.ticketCount} · fetched {new Date(diggingDataset.fetchedAt).toLocaleTimeString()} · <em>{diggingDataset.productId}</em>
          <button type="button" className="chatbot-scope-clear" onClick={() => setDiggingDataset(null)}>Clear dataset</button>
        </div>
      )}
      {chatMode === 'digging' && !diggingDataset && (
        <div className="chatbot-scope">
          {ENABLE_JIRA_DIGGING ? 'No dataset yet — enter JQL above and hit Fetch & Index, then Ask (grounded, cites [KEY-...]).' : 'Custom JQL Digging is disabled by feature flag.'}
        </div>
      )}

      <div className="chatbot-messages">
        {messages.length === 0 && chatMode === 'active' && (
          <div className="chatbot-empty">
            Try: "compare 2 releases", "what is blocking FEAT-xxxx", or "show top P0/P1 risks".
          </div>
        )}
        {messages.length === 0 && chatMode === 'digging' && (
          <div className="chatbot-empty">
            {diggingDataset
              ? `Dataset ready (${diggingDataset.ticketCount} tickets). Ask: "summarize these tickets", "top P0/P1 blockers in this set", or "which tickets lack fixVersion?" — answers grounded, cite [KEY-...].`
              : 'Pick Custom JQL Digging → enter JQL → Fetch & Index, then ask questions scoped to that set.'}
          </div>
        )}
        {messages.map((m, idx) => (
          <div key={`${m.role}-${idx}`} className={`chatbot-message ${m.role}`}>
            <div className="chatbot-role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="chatbot-content">{linkifyTicketKeys(m.content)}</div>
            {m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length > 0 && (
              <ul className="chatbot-trace" aria-label="Tool trace">
                {m.trace.map((step, stepIdx) => (
                  <li key={`${step.tool}-${stepIdx}`} className={step.ok ? 'ok' : 'fail'}>
                    {step.tool}
                    {step.detail ? ` · ${step.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {m.role === 'assistant' && m.provenanceId && (
              <div className="chatbot-provenance">Provenance {m.provenanceId.slice(0, 8)}</div>
            )}
            {m.role === 'assistant' &&
              Array.isArray(m.pendingApprovals) &&
              m.pendingApprovals.map((row) => (
                <div key={row.id} className="chatbot-hitl">
                  <span>
                    HITL {row.tool} · {row.status}
                    {row.status === 'pending' ? ' — will not write to JIRA (D26 open)' : ''}
                  </span>
                  {row.status === 'pending' && (
                    <span className="chatbot-hitl-actions">
                      <button type="button" onClick={() => decideApproval(row.id, 'approve')}>
                        Approve
                      </button>
                      <button type="button" onClick={() => decideApproval(row.id, 'reject')}>
                        Reject
                      </button>
                    </span>
                  )}
                </div>
              ))}
          </div>
        ))}
        {loading && <div className="chatbot-loading">Generating response...</div>}
      </div>

      {error && <div className="chatbot-error">{error}</div>}

      <form className="chatbot-input-row" onSubmit={onSubmit}>
        <input
          ref={promptRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={chatMode === 'digging' ? (diggingDataset ? 'Ask about the staged JQL set — e.g. "summarize blockers in this dataset"' : 'Fetch & Index a dataset first, then ask') : 'Ask about release health, blockers, or ticket status...'}
          disabled={loading || (chatMode === 'digging' && !ENABLE_JIRA_DIGGING)}
        />
        <button type="submit" disabled={loading || !prompt.trim() || (chatMode === 'digging' && (!diggingDataset || !ENABLE_JIRA_DIGGING))}>
          {chatMode === 'digging' ? 'Ask' : 'Send'}
        </button>
      </form>
      {chatMode === 'digging' && diggingDataset && (
        <div className="chatbot-digging-hint">Answers are grounded in your staged set and cite tickets as [KEY-...].</div>
      )}
    </div>
  );
}

