import React, { useState, useCallback, useEffect } from 'react';
import { authenticatedPost } from '../../utils/api';
import { jiraDataToAiItem } from './gateDateUtils';

const DATE_PREFIX_REGEX = /^\[\d{4}-\d{2}-\d{2}\]\s*/;

/**
 * Ephemeral AI draft for Email Sender — same NAI gateway as Project Status.
 * Does not push to JIRA or include in the outbound email.
 */
function AiSummaryDraft({ jiraData, issueBreakdown, release }) {
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft('');
    setError('');
  }, [jiraData?.key]);

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
      setDraft(summary);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [jiraData, issueBreakdown, release]);

  if (!jiraData) return null;

  return (
    <div className="form-group">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <label htmlFor="ai-summary-draft" style={{ marginBottom: 0 }}>
          AI summary draft
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          style={{
            fontSize: '0.8125rem',
            padding: '4px 12px',
            cursor: generating ? 'wait' : 'pointer',
            border: '1px solid #1a1a1a',
            borderRadius: '4px',
            background: generating ? '#e9ecef' : '#fff',
            color: '#1a1a1a',
            whiteSpace: 'nowrap',
          }}
        >
          {generating ? 'Generating…' : 'Generate Fresh AI Summary'}
        </button>
      </div>
      <textarea
        id="ai-summary-draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        placeholder="Click Generate Fresh AI Summary to draft from JIRA signals (not saved, not emailed)…"
        className="text-input"
        style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
      />
      {error && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.8125rem', color: '#c53030' }}>
          {error}
        </div>
      )}
      <small className="help-text">
        Scratch pad only — copy useful lines into Highlights and Lowlights. Nothing is written to JIRA.
      </small>
    </div>
  );
}

export default AiSummaryDraft;
