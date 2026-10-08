/**
 * SosTierSummaryBox — one work-tier team-exec summary box for SoS.
 * Neutral chrome; RAG badge inside the body (no triple RAG colouring).
 */

import React from 'react';

const RAG_COLORS = {
  GREEN: { bg: '#ebfbee', border: '#2f9e44', text: '#2b8a3e', dot: '#2f9e44' },
  YELLOW: { bg: '#fff9db', border: '#f08c00', text: '#e67700', dot: '#f08c00' },
  RED: { bg: '#fff5f5', border: '#e03131', text: '#c92a2a', dot: '#e03131' },
};

const JIRA_BASE = 'https://jira.nutanix.com';
const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** Prefer RED|YELLOW|GREEN word; else single emoji before TLDR. Use | not []. */
function pickVerdictFromLine(text) {
  if (!text) return null;
  const plain = String(text).match(/\b(RED|YELLOW|GREEN)\b/i);
  if (plain) return plain[1].toUpperCase();
  const beforeTldr = String(text).match(/(🔴|🟡|🟢)\s*TLDR/i);
  if (beforeTldr) {
    return beforeTldr[1] === '🔴' ? 'RED' : beforeTldr[1] === '🟡' ? 'YELLOW' : 'GREEN';
  }
  const any = String(text).match(/🔴|🟡|🟢/);
  if (any) return any[0] === '🔴' ? 'RED' : any[0] === '🟡' ? 'YELLOW' : 'GREEN';
  return null;
}

function RagBadge({ verdict }) {
  const col = RAG_COLORS[verdict] || RAG_COLORS.YELLOW;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 12,
      background: col.bg, border: `1px solid ${col.border}`,
      color: col.text, fontWeight: 700, fontSize: 11,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.dot, flexShrink: 0 }} />
      {verdict}
    </span>
  );
}

function linkifyTickets(text, baseKey) {
  const parts = [];
  let last = 0;
  let match;
  let i = 0;
  TICKET_RE.lastIndex = 0;
  while ((match = TICKET_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = match[1];
    parts.push(
      <a
        key={`${baseKey}-${i++}`}
        href={`${JIRA_BASE}/browse/${key}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#0052cc', fontWeight: 600, textDecoration: 'none' }}
      >
        {key}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Strip the leading "## <Tier> — <Release>" heading that the AI always
 * writes as line 1. The SosTierSummaryBox chrome already shows the tier
 * name in its header, so rendering it again creates a double-header.
 */
function stripTierHeading(text) {
  if (!text) return text;
  // Match: ## <anything> — <anything>  (first non-blank line only)
  return text.replace(/^(\s*## [^\n]*—[^\n]*\n?)/, '');
}

function SummaryBody({ text }) {
  if (!text) return null;
  const lines = stripTierHeading(text).split('\n');
  const elements = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={key++} style={{ height: 4 }} />);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3);
      const verdict = pickVerdictFromLine(heading);
      elements.push(
        <div key={key++} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          margin: '0 0 6px', paddingBottom: 4,
          borderBottom: '1px solid #f1f3f5',
        }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#343a40' }}>
            {heading.replace(/🔴|🟡|🟢/g, '').replace(/\/+/g, '').replace(/\b(RED|YELLOW|GREEN)\b/gi, '').replace(/\s+/g, ' ').trim()}
          </span>
          {verdict && <RagBadge verdict={verdict} />}
        </div>
      );
    } else if (/^No items in this tier/i.test(trimmed)) {
      elements.push(
        <p key={key++} style={{ margin: '4px 0', fontSize: 12.5, color: '#868e96', lineHeight: 1.45, fontStyle: 'italic' }}>
          {trimmed}
        </p>
      );
    } else if (/^[-•]/.test(trimmed)) {
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 6, margin: '2px 0', fontSize: 12, color: '#343a40' }}>
          <span style={{ color: '#adb5bd', flexShrink: 0 }}>•</span>
          <span>{linkifyTickets(trimmed.slice(1).trim(), `b${key}`)}</span>
        </div>
      );
    } else if (/TLDR/i.test(trimmed) || /^(📋|✅|⚠️|👁)/.test(trimmed) || /^(Key Risks|Top Actions|Next Owner Actions|Call-outs|Keep an eye)/i.test(trimmed)) {
      const tldrMatch = trimmed.match(/^(?:(?:🔴|🟡|🟢)(?:\s*\/\s*(?:🔴|🟡|🟢))*)?\s*TLDR:\s*(.*)$/i);
      if (tldrMatch) {
        const verdict = pickVerdictFromLine(trimmed) || pickVerdictFromLine(tldrMatch[1]);
        elements.push(
          <div key={key++} style={{ margin: '4px 0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#495057' }}>TLDR</span>
              {verdict && <RagBadge verdict={verdict} />}
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: '#343a40', lineHeight: 1.45 }}>
              {linkifyTickets(tldrMatch[1].replace(/^(?:🔴|🟡|🟢)\s*/, ''), `t${key}`)}
            </p>
          </div>
        );
      } else if (/^(📋|✅|⚠️|👁|Key Risks|Top Actions|Next Owner Actions|Call-outs|Keep an eye)/i.test(trimmed)) {
        elements.push(
          <div key={key++} style={{ fontWeight: 700, fontSize: 11, color: '#495057', margin: '8px 0 4px' }}>
            {trimmed.replace(/^(📋|✅|⚠️|👁)\s*/, '')}
          </div>
        );
      } else {
        elements.push(
          <p key={key++} style={{ margin: '2px 0', fontSize: 12, color: '#495057', lineHeight: 1.45 }}>
            {linkifyTickets(trimmed, `p${key}`)}
          </p>
        );
      }
    } else {
      elements.push(
        <p key={key++} style={{ margin: '2px 0', fontSize: 12, color: '#495057', lineHeight: 1.45 }}>
          {linkifyTickets(trimmed, `p${key}`)}
        </p>
      );
    }
  }
  return <>{elements}</>;
}

export default function SosTierSummaryBox({ title, tierState, onRetry }) {
  const state = tierState?.state || 'idle';
  const summary = tierState?.summary;
  const error = tierState?.error;

  return (
    <div style={{
      flex: '1 1 280px',
      minWidth: 260,
      border: '1px solid #dee2e6',
      borderRadius: 8,
      background: '#fff',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '8px 12px',
        background: '#f8f9fa',
        borderBottom: '1px solid #dee2e6',
        fontWeight: 700,
        fontSize: 12,
        color: '#343a40',
      }}>
        {title}
      </div>
      <div style={{ padding: '10px 12px', flex: 1, minHeight: 80 }}>
        {state === 'idle' && (
          <p style={{ margin: 0, fontSize: 12, color: '#adb5bd' }}>
            Click Generate Exec Summary to fill this box.
          </p>
        )}
        {state === 'loading' && (
          <p style={{ margin: 0, fontSize: 12, color: '#868e96' }}>Generating…</p>
        )}
        {state === 'error' && (
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c92a2a' }}>
              {error || 'Server error. Please try again in a moment.'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                style={{
                  fontSize: 11, border: '1px solid #adb5bd', borderRadius: 4,
                  background: '#fff', padding: '2px 8px', cursor: 'pointer',
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}
        {state === 'done' && <SummaryBody text={summary} />}
      </div>
      {state === 'done' && tierState?.generatedAt && (
        <div style={{ padding: '4px 12px 8px', fontSize: 10, color: '#adb5bd' }}>
          Generated {new Date(tierState.generatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
