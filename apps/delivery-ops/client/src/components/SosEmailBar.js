/**
 * Email SoS button + confirm dialog.
 * Serializes already-loaded page state; does not refetch JIRA.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { usePermissions } from '../auth/hooks/usePermissions';
import { PERMISSIONS } from '../auth/constants/permissions';
import { useSosEmail } from '../hooks/useSosEmail';

function formatList(list) {
  if (!list || list.length === 0) return '—';
  return list.join(', ');
}

export default function SosEmailBar({
  byVersion,
  breakdownDataMap,
  gateDataMap,
  checkpointHistory,
  jiraBaseUrl,
  sortedVersions,
  tierSummaries = {},
  disabled,
}) {
  const { hasPermission } = usePermissions();
  const canSend = hasPermission(PERMISSIONS.EMAIL_SEND_GENERIC);
  const { sending, previewing, error, success, preview, previewEmail, sendEmail, reset } = useSosEmail();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const snapshot = useMemo(() => ({
    byVersion,
    breakdownDataMap,
    gateDataMap,
    checkpointHistory,
    jiraBaseUrl,
    sortedVersions,
    tierSummaries,
  }), [byVersion, breakdownDataMap, gateDataMap, checkpointHistory, jiraBaseUrl, sortedVersions, tierSummaries]);

  const handleOpen = useCallback(async () => {
    try {
      await previewEmail(snapshot);
      setConfirmOpen(true);
    } catch {
      setConfirmOpen(false);
    }
  }, [previewEmail, snapshot]);

  const handleCancel = useCallback(() => {
    setConfirmOpen(false);
    reset();
  }, [reset]);

  const handleSend = useCallback(async () => {
    try {
      await sendEmail(snapshot);
      setConfirmOpen(false);
    } catch {
      // error is shown from hook state; keep dialog open so user can retry
    }
  }, [sendEmail, snapshot]);

  if (!canSend) return null;

  const busy = sending || previewing || disabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
      <button
        type="button"
        onClick={handleOpen}
        disabled={busy}
        title="Email the current SoS view via SMTP (no JIRA refetch)"
        style={{
          padding: '6px 14px',
          fontSize: '12px',
          borderRadius: '5px',
          border: '1px solid #2e7d32',
          background: busy ? '#e8f5e9' : '#2e7d32',
          color: busy ? '#2e7d32' : '#fff',
          cursor: busy ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {previewing ? 'Preparing…' : sending ? 'Sending…' : 'Email SoS'}
      </button>
      {success && (
        <span style={{ fontSize: '11px', color: '#2e7d32', fontWeight: 600, maxWidth: '360px', textAlign: 'right' }}>
          {success}
        </span>
      )}
      {error && !confirmOpen && (
        <span style={{ fontSize: '11px', color: '#d32f2f', maxWidth: '360px', textAlign: 'right' }}>
          {error}
        </span>
      )}

      {confirmOpen && preview && (
        <div
          role="dialog"
          aria-label="Confirm SoS email"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div style={{
            background: '#fff',
            borderRadius: '8px',
            maxWidth: '560px',
            width: '100%',
            padding: '20px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#1a1a2e' }}>Send SoS email?</h3>
            <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#666' }}>
              Sends a snapshot of the current page. JIRA is not queried again.
            </p>
            <div style={{ fontSize: '12px', lineHeight: 1.5, marginBottom: '12px' }}>
              <div><strong>Subject:</strong> {preview.subject}</div>
              <div><strong>To:</strong> {formatList(preview.to)}</div>
              <div><strong>CC:</strong> {formatList(preview.cc)}</div>
            </div>
            {error && (
              <p style={{ color: '#d32f2f', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={sending}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  background: '#fff',
                  cursor: sending ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#2e7d32',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: sending ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
