import React, { useState } from 'react';
import { useChat } from '../hooks/useChat';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
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
  const { selectedRelease, setSelectedRelease, activeVersions, inactiveVersions } = useSelectedRelease();
  const { messages, loading, error, scope, sendMessage, clearChat } = useChat();
  const [prompt, setPrompt] = useState('');

  const allVersions = [...(activeVersions || []), ...(inactiveVersions || [])];

  const onSubmit = async (e) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || loading) return;
    setPrompt('');
    await sendMessage(text);
  };

  return (
    <div className="chatbot-page">
      <div className="chatbot-header">
        <div>
          <h1>AI Chatbot</h1>
          <p>Ask release, ticket, and risk questions grounded in cached release context.</p>
        </div>
        <div className="chatbot-controls">
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
          <button type="button" onClick={clearChat} className="chatbot-clear-btn">
            Clear
          </button>
        </div>
      </div>

      {scope && (
        <div className="chatbot-scope">
          <strong>Scope:</strong> {scope.intent} · releases: {(scope.releases || []).join(', ') || 'none'} ·
          keys: {(scope.ticketKeys || []).join(', ') || 'none'}
        </div>
      )}

      <div className="chatbot-messages">
        {messages.length === 0 && (
          <div className="chatbot-empty">
            Try: "compare 2 releases", "what is blocking FEAT-xxxx", or "show top P0/P1 risks".
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
          </div>
        ))}
        {loading && <div className="chatbot-loading">Generating response...</div>}
      </div>

      {error && <div className="chatbot-error">{error}</div>}

      <form className="chatbot-input-row" onSubmit={onSubmit}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask about release health, blockers, or ticket status..."
          disabled={loading}
        />
        <button type="submit" disabled={loading || !prompt.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

