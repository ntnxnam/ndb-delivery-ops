import React from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import OutlookFallback from '../shared/OutlookFallback';
import AiSummaryDraft from './AiSummaryDraft';
import RiskAndPathBoxes from './RiskAndPathBoxes';
import GateDatesBarChart from './GateDatesBarChart';
import {
  ccDisplayLabel,
  isHighlightsLowlightsEmpty,
  validateHighlightsLowlightsSections,
} from './emailSenderHelpers';
import EmailSenderPulledPanel from './EmailSenderPulledPanel';
import { getFieldValue } from '../../utils/jiraFields';
import { useEmailSender } from '../../hooks/useEmailSender';
import './EmailSender.css';

function EmailSender({ onLogout: _onLogout }) {
  const s = useEmailSender();
  const {
    jiraBaseUrl, optionalCCList, username, jiraToken, quillRef, quillModules,
    additionalDetails, setAdditionalDetails,
    aiSummaryDraft, setAiSummaryDraft,
    emailRecipients, setEmailRecipients,
    emailRecipientsError,
    emailSubject, setEmailSubject,
    jiraKey, setJiraKey,
    validatingJira, jiraValidationStatus, setJiraValidationStatus,
    fetchingJira, jiraData, setJiraData,
    fetchingEpics, epics, fetchingBreakdown, issueBreakdown, workItems, payloadJql,
    featureDashExtras, sprintGanttData, fetchingSprintGantt,
    pulledTicketDataOpen, setPulledTicketDataOpen,
    loading, error, setError, success, attachPdf, setAttachPdf,
    testMode, setTestMode, dryRun, setDryRun,
    optionalCCChecked, setOptionalCCChecked,
    validateEmailRecipients, normalizeEmailRecipients, formatJiraWikiMarkup,
    fetchJiraData, handleSend, handleClearAll, previewEmail,
  } = s;

  return (
    <div className="email-sender">
      <div className="card">

        <div className="form-group">
          <label htmlFor="jira-key">JIRA FEAT Key *</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <input
              type="text"
              id="jira-key"
              value={jiraKey}
              onChange={(e) => {
                setJiraKey(e.target.value);
                setJiraValidationStatus(null);
                setJiraData(null);
              }}
              placeholder="FEAT-12345"
              className="text-input"
              style={{ flex: 1, minWidth: '200px' }}
              required
            />
            <button
              type="button"
              onClick={fetchJiraData}
              disabled={validatingJira || fetchingJira || !jiraKey.trim() || !jiraToken}
              title="Validates the ticket first, then fetches full ticket data: custom fields, dates, epics, and issue breakdown"
              style={{
                padding: '8px 16px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: validatingJira || fetchingJira || !jiraKey.trim() || !jiraToken ? 'not-allowed' : 'pointer',
                opacity: validatingJira || fetchingJira || !jiraKey.trim() || !jiraToken ? 0.6 : 1,
                whiteSpace: 'nowrap'
              }}
            >
              {validatingJira ? 'Validating...' : fetchingJira ? 'Fetching...' : 'Fetch'}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={loading}
              title="Clear all form fields and start over"
              style={{
                padding: '8px 16px',
                backgroundColor: '#f5f5f5',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                whiteSpace: 'nowrap'
              }}
            >
              Clear All
            </button>
          </div>
          {jiraValidationStatus && (
            <div style={{
              marginTop: '8px',
              padding: '12px',
              borderRadius: '4px',
              backgroundColor: jiraValidationStatus.valid ? '#d4edda' : '#f8d7da',
              color: jiraValidationStatus.valid ? '#155724' : '#721c24',
              fontSize: '13px',
              whiteSpace: 'pre-line',
              lineHeight: '1.6'
            }}>
              {jiraValidationStatus.message}
            </div>
          )}
          {(!jiraToken || !username) && (
            <small className="help-text" style={{ color: '#dc3545', display: 'block', marginTop: '4px' }}>
              JIRA credentials missing — log in again.
            </small>
          )}
        </div>

        {jiraData && (
          <div className="email-sender-strip">
            <a
              href={`${jiraBaseUrl}/browse/${jiraData.key}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {jiraData.key}
            </a>
            <span className="email-sender-strip-sep">·</span>
            <span className="email-sender-strip-summary" title={jiraData.summary}>{jiraData.summary}</span>
            <span className="email-sender-strip-sep">·</span>
            <span>{jiraData.status}</span>
            {jiraData.fixVersions && jiraData.fixVersions !== 'N/A' && (
              <>
                <span className="email-sender-strip-sep">·</span>
                <span>{jiraData.fixVersions}</span>
              </>
            )}
            {(() => { const _risk = getFieldValue(jiraData, 'riskIndicator') ?? jiraData.customfield_23560; return _risk?.value ? (
              <span
                className="email-sender-strip-risk"
                style={{
                  backgroundColor: _risk.color || '#e9ecef',
                  color: _risk.color ? '#fff' : '#1a1a1a',
                }}
              >
                {_risk.value}
              </span>
            ) : null; })()}
          </div>
        )}

        <EmailSenderPulledPanel
          jiraData={jiraData}
          jiraBaseUrl={jiraBaseUrl}
          jiraKey={jiraKey}
          pulledTicketDataOpen={pulledTicketDataOpen}
          setPulledTicketDataOpen={setPulledTicketDataOpen}
          formatJiraWikiMarkup={formatJiraWikiMarkup}
          featureDashExtras={featureDashExtras}
          epics={epics}
          fetchingEpics={fetchingEpics}
          issueBreakdown={issueBreakdown}
          fetchingBreakdown={fetchingBreakdown}
          workItems={workItems}
          payloadJql={payloadJql}
          sprintGanttData={sprintGanttData}
          fetchingSprintGantt={fetchingSprintGantt}
        />


        {jiraData && (
          <>
            <GateDatesBarChart jiraData={jiraData} workItems={workItems} />
            <RiskAndPathBoxes jiraData={jiraData} />
          </>
        )}

        {jiraData && (
          <div className="form-group">
            <label id="email-subject-label">Subject</label>
            <div
              id="email-subject"
              role="textbox"
              aria-labelledby="email-subject-label"
              aria-readonly="true"
              style={{
                padding: '6px 8px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '0.8125rem',
                color: '#495057',
              }}
            >
              {emailSubject || 'Auto-filled after fetch'}
            </div>
          </div>
        )}

        {jiraData && (
          <>
            <div className="form-group">
              <label id="highlights-lowlights-label">Highlights / Lowlights / Support *</label>
              <div id="highlights-lowlights" role="textbox" aria-labelledby="highlights-lowlights-label" aria-multiline="true">
                <ReactQuill
                  ref={quillRef}
                  value={additionalDetails}
                  onChange={setAdditionalDetails}
                  modules={quillModules}
                  placeholder="Highlights, lowlights, and support needed from leaders…"
                  className="rich-text-editor"
                />
              </div>
              {!isHighlightsLowlightsEmpty(additionalDetails) && (() => {
                const { missingSections } = validateHighlightsLowlightsSections(additionalDetails);
                if (missingSections.length === 0) return null;
                const handleAddMissingSections = () => {
                  const appended = missingSections.map(s =>
                    `<h2>${s}:</h2><p><br></p><p><br></p>`
                  ).join('');
                  setAdditionalDetails(prev => prev + appended);
                };
                return (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#c53030' }}>
                      <strong>Missing sections:</strong> {missingSections.join('; ')}
                    </span>
                    <button
                      type="button"
                      onClick={handleAddMissingSections}
                      style={{
                        fontSize: '0.8125rem',
                        padding: '2px 10px',
                        cursor: 'pointer',
                        border: '1px solid #c53030',
                        borderRadius: '4px',
                        background: '#fff',
                        color: '#c53030',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      + Add missing sections
                    </button>
                  </div>
                );
              })()}
            </div>

            <details className="email-sender-ai" open>
              <summary>AI risk summary (required — included in email)</summary>
              <AiSummaryDraft
                jiraData={jiraData}
                issueBreakdown={issueBreakdown}
                release={jiraData.fixVersions && jiraData.fixVersions !== 'N/A' ? jiraData.fixVersions.split(',')[0].trim() : null}
                draft={aiSummaryDraft}
                onDraftChange={setAiSummaryDraft}
                loadingBreakdown={fetchingEpics || fetchingBreakdown}
              />
            </details>

            {optionalCCList.length > 0 && (
              <div className="form-group">
                <label>CC (optional — select to include)</label>
                <div
                  className="email-sender-optional-cc"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '0.25rem 1.5rem',
                    marginTop: '0.35rem'
                  }}
                >
                  {optionalCCList.map((email, i) => (
                    <label
                      key={email}
                      htmlFor={`email-sender-cc-${i}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '13px' }}
                      title={email}
                    >
                      <input
                        type="checkbox"
                        id={`email-sender-cc-${i}`}
                        checked={optionalCCChecked[String(i)] || false}
                        onChange={() => setOptionalCCChecked((prev) => ({
                          ...prev,
                          [String(i)]: !prev[String(i)]
                        }))}
                        disabled={loading}
                      />
                      <span>{ccDisplayLabel(email)}</span>
                    </label>
                  ))}
                </div>
                <small className="help-text">Not CC'd unless checked. Sender is always CC'd.</small>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email-recipients">Additional Recipients</label>
              <input
                type="text"
                id="email-recipients"
                value={emailRecipients}
                onChange={(e) => {
                  const value = e.target.value;
                  setEmailRecipients(value);
                  validateEmailRecipients(value);
                }}
                onBlur={(e) => {
                  // Normalize on blur (convert usernames to emails)
                  if (validateEmailRecipients(e.target.value)) {
                    const normalized = normalizeEmailRecipients(e.target.value);
                    if (normalized !== e.target.value) {
                      setEmailRecipients(normalized);
                    }
                  }
                }}
                placeholder="user@nutanix.com; username (optional)"
                className="text-input"
                style={{
                  borderColor: emailRecipientsError ? '#c53030' : '#1a1a1a'
                }}
              />
              {emailRecipientsError && (
                <div style={{ 
                  color: '#c53030', 
                  fontSize: '0.8125rem', 
                  marginTop: '0.5rem' 
                }}>
                  {emailRecipientsError}
                </div>
              )}
              <small className="help-text">Optional. Semicolon-separated Nutanix emails or usernames.</small>
            </div>


          </>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        {/* Only show Send Email button after Fetch is complete */}
        {jiraData && (
          <div className="button-group" style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '20px', flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1
            }}>
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
                disabled={loading}
                style={{ width: '18px', height: '18px', cursor: loading ? 'not-allowed' : 'pointer' }}
              />
              <span>Attach PDF</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1
            }}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={loading}
                style={{ width: '18px', height: '18px', cursor: loading ? 'not-allowed' : 'pointer' }}
              />
              <span>Dry run (don&apos;t send)</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1
            }}>
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                disabled={loading}
                style={{ width: '18px', height: '18px', cursor: loading ? 'not-allowed' : 'pointer' }}
              />
              <span>Test mode (send only to me)</span>
            </label>
            {(() => {
              const missing = validateHighlightsLowlightsSections(additionalDetails).missingSections;
              const disabledReason = !jiraKey.trim()
                ? 'JIRA key is required'
                : isHighlightsLowlightsEmpty(additionalDetails)
                  ? 'Highlights and Lowlights is required'
                  : missing.length > 0
                    ? `Missing sections: ${missing.join('; ')}`
                    : !String(aiSummaryDraft || '').trim()
                      ? 'Generate AI risk summary before sending'
                      : '';
              return (
                <>
                  <button
                    onClick={handleSend}
                    className="btn-send"
                    disabled={loading || !!disabledReason}
                    title={disabledReason || undefined}
                  >
                    {loading ? 'Sending...' : 'Send Email'}
                  </button>
                  <span className="copy-email-wrap" aria-label="Copy email actions">
                    <OutlookFallback
                      buttonLabel="Copy Email to Clipboard"
                      getPreview={previewEmail}
                    />
                  </span>
                </>
              );
            })()}
          </div>
        )}


      </div>
    </div>
  );
}

export default EmailSender;

