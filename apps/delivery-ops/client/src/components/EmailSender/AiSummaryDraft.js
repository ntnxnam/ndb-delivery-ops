import React, { useState, useCallback, useEffect } from 'react';
import { authenticatedGet, authenticatedPost } from '../../shared/services/apiService';
import { jiraDataToAiItem } from './gateDateUtils';

const DATE_PREFIX_REGEX = /^\[\d{4}-\d{2}-\d{2}\]\s*/;

/**
 * Normalize release key for releaseGateDates lookup.
 * Handles "NDB 2.12" vs "NDB-2.12" vs "2.12" aliases and case differences.
 * Returns the matched config key or null.
 */
export function resolveReleaseKey(requested, releaseGateDates) {
  if (!requested || !releaseGateDates || typeof releaseGateDates !== 'object') return null;
  const raw = String(requested).trim();
  if (!raw) return null;
  if (releaseGateDates[raw]) return raw;
  // case-insensitive direct match
  const lower = raw.toLowerCase();
  for (const k of Object.keys(releaseGateDates)) {
    if (k.toLowerCase() === lower) return k;
  }
  // Normalize separators: treat " " and "-" and "_" as equivalent
  const norm = (s) => s.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
  const normRequested = norm(raw);
  for (const k of Object.keys(releaseGateDates)) {
    if (norm(k) === normRequested) return k;
  }
  // Try matching by version suffix only (e.g. "2.12" matches "NDB 2.12")
  // Only if requested looks like a version number
  if (/^\d+\.\d+/.test(raw)) {
    for (const k of Object.keys(releaseGateDates)) {
      if (k.toLowerCase().endsWith(raw.toLowerCase()) || norm(k).endsWith(normRequested)) return k;
    }
  }
  return null;
}

/**
 * AI risk summary for Email Sender — same NAI gateway as Project Status.
 * Parent owns draft state so it can be included in the outbound email.
 * Loads per-release ganttConfig so gate-aware CRITICAL_RISKS (MISSED GATE / overshoot) can fire.
 */
function AiSummaryDraft({ jiraData, issueBreakdown, release, draft, onDraftChange, loadingBreakdown }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [warnMissingBreakdown, setWarnMissingBreakdown] = useState(false);

  // Clear draft only on key change; same-key re-fetch is handled by parent (useEmailSender)
  useEffect(() => {
    onDraftChange?.('');
    setError('');
    setWarnMissingBreakdown(false);
  }, [jiraData?.key]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only on ticket change

  const handleGenerate = useCallback(async () => {
    const item = jiraDataToAiItem(jiraData);
    if (!item) {
      setError('Fetch JIRA data first.');
      return;
    }

    setGenerating(true);
    setError('');
    setWarnMissingBreakdown(false);
    try {
      let ganttConfig = null;
      if (release) {
        try {
          const cfgResp = await authenticatedGet('/api/config/release-versions');
          const gateDates = cfgResp.data?.releaseGateDates || {};
          const resolvedKey = resolveReleaseKey(release, gateDates);
          ganttConfig = resolvedKey ? gateDates[resolvedKey] : null;
          if (!ganttConfig && release) {
            console.warn(`[AiSummaryDraft] releaseGateDates miss for "${release}" — available: ${Object.keys(gateDates).join(', ')}`);
          }
        } catch {
          ganttConfig = null;
        }
      }

      if (!issueBreakdown) {
        setWarnMissingBreakdown(true);
      }

      const resp = await authenticatedPost('/api/ai/exec-summary', {
        item,
        ganttConfig,
        breakdownData: issueBreakdown || null,
        release: release || null,
        releaseContext: null,
      });
      const summary = resp.data?.summary || '';
      const body = summary.replace(DATE_PREFIX_REGEX, '').trim();
      if (!body) {
        setError('AI returned an empty summary. Please regenerate.');
        return;
      }
      onDraftChange?.(summary);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [jiraData, issueBreakdown, release, onDraftChange]);

  if (!jiraData) return null;

  const isLoading = Boolean(loadingBreakdown);

  return (
    <div className="form-group">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.35rem' }}>
        {isLoading && (
          <span style={{ fontSize: '0.75rem', color: '#6c757d' }}>loading task breakdown…</span>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || isLoading}
          title={isLoading ? 'Wait for task breakdown to finish loading' : undefined}
          style={{
            fontSize: '0.75rem',
            padding: '3px 10px',
            cursor: generating || isLoading ? 'wait' : 'pointer',
            border: '1px solid #1a1a1a',
            borderRadius: '4px',
            background: generating || isLoading ? '#e9ecef' : '#fff',
            color: '#1a1a1a',
          }}
        >
          {generating ? 'Generating…' : 'Generate Fresh AI Summary'}
        </button>
      </div>
      {warnMissingBreakdown && (
        <div style={{ marginBottom: '0.35rem', fontSize: '0.75rem', color: '#856404', background: '#fff3cd', padding: '4px 8px', borderRadius: '4px' }}>
          Generated without task breakdown — brief may miss open bugs / blockers. Re-generate after breakdown loads for a complete brief.
        </div>
      )}
      <textarea
        id="ai-summary-draft"
        value={draft || ''}
        onChange={(e) => onDraftChange?.(e.target.value)}
        rows={3}
        placeholder="Generate AI risk summary — included in the email when you send…"
        className="text-input"
        style={{ fontFamily: 'inherit', lineHeight: 1.4, fontSize: '0.8125rem' }}
      />
      {error && (
        <div style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: '#c53030' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default AiSummaryDraft;
