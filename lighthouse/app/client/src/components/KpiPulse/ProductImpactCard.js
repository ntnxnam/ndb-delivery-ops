import React from 'react';

const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const DEFAULT_JIRA = 'https://jira.nutanix.com';

function ticketHref(base, key) {
  return `${String(base || DEFAULT_JIRA).replace(/\/+$/, '')}/browse/${key}`;
}

function linkify(text, jiraBase) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  let match;
  let i = 0;
  TICKET_RE.lastIndex = 0;
  while ((match = TICKET_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = match[1];
    parts.push(
      <a key={`${key}-${i++}`} href={ticketHref(jiraBase, key)} target="_blank" rel="noopener noreferrer">
        {key}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Qualitative product-impact shell. Parent supplies onGenerate (AI or deterministic).
 * Does not fetch — components render only.
 */
export default function ProductImpactCard({
  productImpact,
  jiraBaseUrl,
  onGenerate,
  generating = false,
  domainHint = 'What does this KPI load mean for the product / release?',
}) {
  const summary = productImpact?.summary;
  const generatedAt = productImpact?.generatedAt;
  const canGenerate = typeof onGenerate === 'function';

  // No inert chrome when parent has neither content nor a generate action
  if (!summary && !canGenerate) return null;

  return (
    <div className="kpi-pulse-impact">
      <h3>Product impact</h3>
      {summary ? (
        <div className="kpi-pulse-impact-body">{linkify(summary, jiraBaseUrl)}</div>
      ) : (
        <p className="kpi-pulse-muted">{domainHint}</p>
      )}
      <div className="kpi-pulse-impact-actions">
        {canGenerate ? (
          <button
            type="button"
            className="kpi-pulse-btn kpi-pulse-btn-primary"
            disabled={generating}
            onClick={onGenerate}
          >
            {generating ? 'Generating…' : summary ? 'Refresh impact brief' : 'Generate impact brief'}
          </button>
        ) : null}
        {generatedAt ? (
          <span className="kpi-pulse-impact-meta">
            As of {new Date(generatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
