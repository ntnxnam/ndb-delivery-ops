import React, { useState, useCallback, useEffect } from 'react';
import { authenticatedPost } from '../../utils/api';
import { jiraDataToAiItem } from './gateDateUtils';

const DATE_PREFIX_REGEX = /^\[\d{4}-\d{2}-\d{2}\]\s*/;

/**
 * AI risk summary for Email Sender — same NAI gateway as Project Status.
 * Parent owns draft state so it can be included in the outbound email.
 */
function AiSummaryDraft({ jiraData, issueBreakdown, release, draft, onDraftChange }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onDraftChange?.('');
    setError('');
  }, [jiraData?.key]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only on ticket change

  const handleGenerate = useCallback(async () => {
    const item = jiraDataToAiItem(jiraData);
    if (!item) {
      setError('Fetch JIRA data first.');
      return;
    }

    setGenerating(true);
    setError('');
    try {
      const resp = await authenticatedPost('/api/ai/exec-summary', {
        item,
        ganttConfig: null,
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

  return (
    <div className="form-group">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.35rem' }}>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          style={{
            fontSize: '0.75rem',
            padding: '3px 10px',
            cursor: generating ? 'wait' : 'pointer',
            border: '1px solid #1a1a1a',
            borderRadius: '4px',
            background: generating ? '#e9ecef' : '#fff',
            color: '#1a1a1a',
          }}
        >
          {generating ? 'Generating…' : 'Generate Fresh AI Summary'}
        </button>
      </div>
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
