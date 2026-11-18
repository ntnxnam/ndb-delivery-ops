import React from 'react';
import OutlookFallback from './shared/OutlookFallback';

/**
 * ReleaseVersionEmailForm Component
 * 
 * Email recipients input and send email button.
 * 
 * @param {Object} props
 * @param {string} props.emailRecipients - Email recipients string
 * @param {string} props.emailRecipientsError - Error message for email recipients
 * @param {boolean} props.sendingEmail - Whether email is being sent
 * @param {boolean} props.emailSuccess - Whether email was sent successfully
 * @param {string} props.username - Current user's username/email
 * @param {Function} props.setEmailRecipients - Handler for email recipients change
 * @param {Function} props.setEmailRecipientsError - Handler for email recipients error
 * @param {Function} props.onSendEmail - Handler for send email button click
 * @param {Function} props.getPreview - Optional async () => ({ to, cc, subject, htmlBody, textBody }) for Open in Outlook
 */
function ReleaseVersionEmailForm({
  emailRecipients,
  emailRecipientsError,
  sendingEmail,
  emailSuccess,
  username,
  setEmailRecipients,
  setEmailRecipientsError,
  onSendEmail,
  getPreview,
  emailOnlyToSelf = false
}) {
  return (
    <>
      <div className="grid-container" style={{ marginBottom: '0.5rem' }}>
        <div className="grid-9" style={{ backgroundColor: '#f8f9fa', padding: '0.75rem' }}>
          <label htmlFor="email-recipients" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
            {emailOnlyToSelf ? 'Recipient' : 'Additional Recipients (Optional)'}
          </label>
          {emailOnlyToSelf ? (
            <div style={{ padding: '0.5rem', fontSize: '0.85rem', color: '#495057', backgroundColor: '#e9ecef', borderRadius: '4px', border: '1px solid #dee2e6' }}>
              Email will be sent only to you (namratha.singh)
            </div>
          ) : (
            <>
              <input
                type="text"
                id="email-recipients"
                value={emailRecipients}
                onChange={(e) => {
                  setEmailRecipients(e.target.value);
                  setEmailRecipientsError('');
                }}
                placeholder="user@nutanix.com, username (comma-separated)"
                className="text-input"
                style={{
                  borderColor: emailRecipientsError ? '#c53030' : '#ddd',
                  padding: '0.5rem',
                  fontSize: '0.85rem'
                }}
              />
              {emailRecipientsError && (
                <div style={{ 
                  color: '#c53030', 
                  fontSize: '0.75rem', 
                  marginTop: '0.3rem' 
                }}>
                  {emailRecipientsError}
                </div>
              )}
              <small className="help-text" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }}>
                Enter Nutanix email addresses or usernames. Separate multiple with commas.
              </small>
            </>
          )}
        </div>
        
        <div className="grid-3" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', paddingBottom: '0.5rem' }}>
          <button
            type="button"
            onClick={onSendEmail}
            className="btn-send"
            disabled={sendingEmail || !username}
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '0.85rem'
            }}
          >
            {sendingEmail ? 'Sending...' : 'Send Email'}
          </button>
          {getPreview && (
            <OutlookFallback
              buttonLabel="Copy Email to Clipboard"
              getPreview={getPreview}
            />
          )}
        </div>
      </div>
      
      {emailSuccess && (
        <div className="success-message" style={{ marginTop: '0.5rem' }}>
          ✓ Email sent successfully!
        </div>
      )}
    </>
  );
}

export default ReleaseVersionEmailForm;

