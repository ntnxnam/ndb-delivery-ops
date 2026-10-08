/**
 * useSosEmail — preview and send the SoS snapshot via SMTP.
 * Builds HTML from in-memory page state; does not call JIRA.
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { buildSosSnapshotHtml } from '../utils/sosEmailHtml';

function authHeaders() {
  return {
    jiraToken: localStorage.getItem('jiraToken') || '',
    username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
  };
}

function buildPayload(data, extra = {}) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  return {
    htmlBody: buildSosSnapshotHtml(data),
    subject: `SoS Summary — ${generatedAt}`,
    releases: data.sortedVersions || Object.keys(data.byVersion || {}),
    ...extra,
  };
}

export function useSosEmail() {
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [preview, setPreview] = useState(null);

  const previewEmail = useCallback(async (data, recipientOverrides = {}) => {
    setPreviewing(true);
    setError('');
    setSuccess('');
    try {
      const resp = await authenticatedPost(
        '/api/email/send-sos',
        buildPayload(data, { previewOnly: true, ...recipientOverrides }),
        authHeaders()
      );
      if (!resp.data?.success) {
        throw new Error(resp.data?.error || 'Preview failed');
      }
      const next = {
        to: resp.data.to || [],
        cc: resp.data.cc || [],
        subject: resp.data.subject || '',
        htmlBody: resp.data.htmlBody || resp.data.preview || '',
      };
      setPreview(next);
      return next;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Preview failed';
      setError(msg);
      throw err;
    } finally {
      setPreviewing(false);
    }
  }, []);

  const sendEmail = useCallback(async (data, recipientOverrides = {}) => {
    setSending(true);
    setError('');
    setSuccess('');
    try {
      const resp = await authenticatedPost(
        '/api/email/send-sos',
        buildPayload(data, recipientOverrides),
        authHeaders()
      );
      if (!resp.data?.success) {
        throw new Error(resp.data?.error || 'Send failed');
      }
      const accepted = resp.data.accepted || [];
      const rejected = resp.data.rejected || [];
      const count = resp.data.recipientCount || accepted.length;
      let msg = `SoS email sent to ${count} recipient(s).`;
      if (rejected.length) {
        msg += ` Rejected: ${rejected.join(', ')}`;
      }
      setSuccess(msg);
      return resp.data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to send SoS email';
      setError(msg);
      throw err;
    } finally {
      setSending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError('');
    setSuccess('');
    setPreview(null);
  }, []);

  return { sending, previewing, error, success, preview, previewEmail, sendEmail, reset };
}
