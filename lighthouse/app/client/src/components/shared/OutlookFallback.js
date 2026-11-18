/**
 * Reusable "Copy Email to Clipboard" button.
 * Fetches the email HTML via getPreview (or uses props directly), then copies
 * rich HTML to clipboard so the user can paste into Outlook with formatting intact.
 */

import React, { useState } from 'react';

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const doc = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (doc) {
    doc.innerHTML = html;
    return doc.textContent || doc.innerText || '';
  }
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fallback for when navigator.clipboard is unavailable (e.g. HTTP / non-secure context).
 * Copies plain text via a temporary textarea and document.execCommand('copy').
 */
function fallbackCopyPlainText(text) {
  if (!text || typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
}

/**
 * @param {string} htmlBody - HTML body to copy (used when getPreview is not provided)
 * @param {string} textBody - Optional plain-text fallback
 * @param {Function} getPreview - Optional async () => ({ htmlBody?, textBody? }) to fetch content before copying
 * @param {object} props - Additional props (e.g. className, style, buttonLabel)
 */
function OutlookFallback({ htmlBody: htmlBodyProp = '', textBody: textBodyProp, getPreview, ...props }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const buttonLabel = props.buttonLabel || 'Copy Email to Clipboard';
  const className = props.className || '';
  const style = props.style || {};

  const doCopy = async (htmlBody, textBody) => {
    const plainBody = textBody != null ? textBody : stripHtml(htmlBody);
    const markCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    };
    try {
      if (htmlBody && window.ClipboardItem && navigator.clipboard?.write) {
        const blob = new Blob([htmlBody], { type: 'text/html' });
        await navigator.clipboard.write([new window.ClipboardItem({ 'text/html': blob })]);
        markCopied();
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plainBody);
        markCopied();
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch (e) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(plainBody);
          markCopied();
          return;
        }
        throw e;
      } catch {
        if (fallbackCopyPlainText(plainBody)) {
          markCopied();
          return;
        }
        setError('Copy failed (try HTTPS or copy manually).');
        setTimeout(() => setError(''), 3000);
      }
    }
  };

  const handleClick = async () => {
    if (getPreview) {
      setLoading(true);
      setError('');
      try {
        const data = await getPreview();
        await doCopy(data.htmlBody || '', data.textBody);
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load preview');
        setTimeout(() => setError(''), 3000);
      } finally {
        setLoading(false);
      }
    } else {
      await doCopy(htmlBodyProp, textBodyProp);
    }
  };

  return (
    <div className={className} style={{ display: 'inline-block', ...style }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: '8px 14px',
          fontSize: '14px',
          cursor: loading ? 'wait' : 'pointer',
          backgroundColor: copied ? '#e6f4ea' : '#f5f5f5',
          border: `1px solid ${copied ? '#276749' : '#ccc'}`,
          borderRadius: '4px',
          color: copied ? '#276749' : '#333',
          transition: 'all 0.2s'
        }}
      >
        {loading ? 'Loading...' : copied ? '✓ Copied!' : buttonLabel}
      </button>
      {error && <div style={{ fontSize: '12px', color: '#c53030', marginTop: '4px' }}>{error}</div>}
    </div>
  );
}

export default OutlookFallback;
export { stripHtml, fallbackCopyPlainText };
