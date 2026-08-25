import React, { useState, useCallback, memo } from 'react';
import { authenticatedPost, authenticatedPut } from '../utils/api';

const STALE_DAYS = 7;
const DATE_PREFIX_REGEX = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;

/**
 * Returns how many days old a date string is, or null if unparseable.
 */
function daysOldFromDate(dateVal) {
  if (!dateVal) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * Parse a stamped exec summary string.
 * Format: "[YYYY-MM-DD] <text>"
 * Returns { text, generatedDate } where generatedDate is a Date or null.
 */
function parseStampedSummary(raw) {
  if (!raw || typeof raw !== 'string') return { text: '', generatedDate: null };
  const match = raw.match(DATE_PREFIX_REGEX);
  if (!match) return { text: raw, generatedDate: null };
  const generatedDate = new Date(match[1]);
  return {
    text: raw.slice(match[0].length).trim(),
    generatedDate: isNaN(generatedDate.getTime()) ? null : generatedDate,
  };
}

/**
 * ExecSummaryCell
 *
 * Staleness is determined by customfield_45660 (Status Update Date).
 * If that date is > 7 days ago → show "⚠ Stale Update" only, no button.
 * Otherwise → show existing summary (if any) + Generate/Regenerate button.
 */
function ExecSummaryCell({ item, selectedVersion, ganttConfig = null, breakdownData = null, releaseContext = null }) {
  const statusUpdateDate = item?.customfield_45660 || null;
  const statusUpdateDaysOld = daysOldFromDate(statusUpdateDate);
  const isStaleUpdate = statusUpdateDaysOld !== null && statusUpdateDaysOld >= STALE_DAYS;

  const existingRaw = item?.customfield_38460 || '';
  const { text: existingText, generatedDate } = parseStampedSummary(existingRaw);
  const hasExisting = Boolean(existingText);
  const summaryAgeDays = daysOldFromDate(generatedDate);
  const summaryIsFresh = summaryAgeDays !== null && summaryAgeDays < STALE_DAYS;

  const [generatedSummary, setGeneratedSummary] = useState('');
  // Local display state — avoids mutating item directly (prevents full tree re-render)
  const [displaySummary, setDisplaySummary] = useState(existingText);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError('');
    setPushSuccess(false);

    try {
      // Server derives phase-aware signals from the full item + ganttConfig +
      // breakdownData. Sending the raw item (rather than a hand-picked subset)
      // lets the server pull whatever fields it needs without us needing to
      // bump the client each time the signal set evolves.
      const resp = await authenticatedPost('/api/ai/exec-summary', {
        item,
        ganttConfig,
        breakdownData,
        release: selectedVersion,
        releaseContext: releaseContext ? {
          totalProjects: releaseContext.totalProjects,
          riskCounts: releaseContext.riskCounts,
          p0BugsCount: releaseContext.p0BugsCount,
          daysFromPG: releaseContext.daysFromPG,
          currentPGDate: releaseContext.currentPGDate,
          currentCGDate: releaseContext.currentCGDate,
        } : null,
      });
      const summary = resp.data?.summary || '';
      // Guard against just-the-stamp ("[YYYY-MM-DD] ") with no actual content.
      const body = summary.replace(DATE_PREFIX_REGEX, '').trim();
      if (!body) {
        setError('AI returned an empty summary. Please regenerate.');
        return;
      }
      setGeneratedSummary(summary);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Generation failed';
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, [item, selectedVersion, ganttConfig, breakdownData, releaseContext]);

  const handlePushToJira = useCallback(async () => {
    if (!generatedSummary) return;
    setPushing(true);
    setError('');
    try {
      await authenticatedPut(`/api/ai/exec-summary/${item.key}`, { summary: generatedSummary });
      setPushSuccess(true);
      // Update local display state instead of mutating item directly
      const { text } = parseStampedSummary(generatedSummary);
      setDisplaySummary(text);
      setGeneratedSummary('');
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Push to JIRA failed';
      setError(msg);
    } finally {
      setPushing(false);
    }
  }, [generatedSummary, item]);

  // ── Stale: status update is over 7 days old — show nothing but the badge ──
  if (isStaleUpdate) {
    return (
      <span style={{
        display: 'inline-block',
        backgroundColor: '#fff3cd',
        border: '1px solid #ffc107',
        color: '#856404',
        fontSize: '10px',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '4px',
      }}>
        ⚠ Stale Update
      </span>
    );
  }

  const buttonLabel = generating ? '⏳ Generating…' : hasExisting ? '↺ Regenerate' : '✨ Generate';

  return (
    <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '200px' }}>

      {/* ── Existing summary from JIRA ── */}
      {displaySummary && !generatedSummary && (
        <div>
          <div style={{ color: '#333', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
            {displaySummary}
          </div>
          {generatedDate && (
            <div style={{ fontSize: '9px', color: '#999', marginTop: '4px', fontStyle: 'italic' }}>
              AI summary from {generatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
      )}

      {/* ── Freshly generated (not yet pushed) ── */}
      {generatedSummary && (() => {
        const { text: genText, generatedDate: genDate } = parseStampedSummary(generatedSummary);
        return (
          <div style={{ backgroundColor: '#f0f7ff', border: '1px solid #b3d7ff', borderRadius: '4px',
            padding: '6px 8px', lineHeight: '1.5', color: '#1a1a2e' }}>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', fontWeight: 600 }}>
              ✨ AI Generated — review before pushing
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{genText}</div>
            {genDate && (
              <div style={{ fontSize: '9px', color: '#999', marginTop: '4px', fontStyle: 'italic' }}>
                Generated {genDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Push success ── */}
      {pushSuccess && (
        <div style={{ color: '#28a745', fontSize: '10px', fontWeight: 600 }}>✓ Saved to JIRA</div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ color: '#dc3545', fontSize: '10px' }}>⚠ {error}</div>
      )}

      {/* ── Buttons ── */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* When no in-flight draft: show Generate/Regenerate button unless summary is fresh.
            When fresh: show age label + a small force-regenerate link so the user can always
            override even when the summary is < 7 days old. */}
        {!generatedSummary && !summaryIsFresh && (
          <button onClick={handleGenerate} disabled={generating} style={{
            fontSize: '10px', padding: '3px 8px',
            backgroundColor: generating ? '#e9ecef' : '#0052cc',
            color: generating ? '#666' : '#fff',
            border: 'none', borderRadius: '3px',
            cursor: generating ? 'not-allowed' : 'pointer',
            fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {buttonLabel}
          </button>
        )}
        {/* Fresh summary: show age label + force-regenerate button */}
        {!generatedSummary && summaryIsFresh && (
          <>
            <span style={{ fontSize: '10px', color: '#6c757d', fontStyle: 'italic' }}>
              {summaryAgeDays === 0 ? 'Generated today' : `Generated ${summaryAgeDays}d ago`}
            </span>
            <button onClick={handleGenerate} disabled={generating} style={{
              fontSize: '10px', padding: '2px 6px',
              backgroundColor: 'transparent',
              color: generating ? '#aaa' : '#6a1b9a',
              border: '1px solid currentColor', borderRadius: '3px',
              cursor: generating ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}>
              {generating ? '⏳' : '↺ Regenerate'}
            </button>
          </>
        )}

        {generatedSummary && !pushSuccess && (
          <>
            <button onClick={handlePushToJira} disabled={pushing} style={{
              fontSize: '10px', padding: '3px 8px',
              backgroundColor: pushing ? '#e9ecef' : '#28a745',
              color: pushing ? '#666' : '#fff',
              border: 'none', borderRadius: '3px',
              cursor: pushing ? 'not-allowed' : 'pointer',
              fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {pushing ? '⏳ Pushing…' : '📤 Push to JIRA'}
            </button>
            <button onClick={() => setGeneratedSummary('')} style={{
              fontSize: '10px', padding: '3px 8px',
              backgroundColor: 'transparent', color: '#666',
              border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer',
            }}>
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(ExecSummaryCell);
