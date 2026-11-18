/**
 * Allowlist HTML sanitizer for status emails (Quill + JIRA-derived fragments).
 * No external deps — strips scripts, event handlers, unsafe CSS, and non-http(s) URLs.
 */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'br', 'p', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'style', 'html', 'head', 'body', 'meta',
  'title',
]);

const VOID_TAGS = new Set(['br', 'meta']);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Allow only http(s) absolute URLs or /browse/... paths.
 * Blocks javascript:, data:, localhost, and 127.0.0.1.
 */
function safeHttpUrl(raw) {
  if (raw == null) return '';
  const url = String(raw).trim();
  if (!url) return '';
  const lower = url.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return '';
  }
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const host = (parsed.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return '';
      return parsed.toString();
    } catch {
      return '';
    }
  }
  // JIRA browse paths only (avoid open /\\host tricks)
  if (/^\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(url) || /^\/issues\/\?jql=/i.test(url)) {
    return url;
  }
  return '';
}

/** Inline style attribute — property declarations only; no urls/imports. */
function sanitizeStyle(style) {
  if (!style || typeof style !== 'string') return '';
  const cleaned = sanitizeCssBlock(style);
  return cleaned.slice(0, 2000);
}

/** CSS block body (<style>…</style>) — drop imports, urls, expressions. */
function sanitizeCssBlock(css) {
  if (!css || typeof css !== 'string') return '';
  return css
    .replace(/@import[\s\S]*?;/gi, '')
    .replace(/@charset[\s\S]*?;/gi, '')
    .replace(/url\s*\([^)]*\)\)?/gi, 'none')
    .replace(/expression\s*\([^)]*\)\)?/gi, 'none')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
    .replace(/behavior\s*:[^;}]*/gi, '')
    .slice(0, 50000);
}

function sanitizeAttrs(tag, attrString) {
  if (!attrString) return '';
  const out = [];
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(attrString)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
    if (name.startsWith('on')) continue;
    // Block meta refresh / open redirects
    if (tag === 'meta' && (name === 'http-equiv' || name === 'content')) continue;
    if (name === 'href' || name === 'src') {
      const safe = safeHttpUrl(value);
      if (safe) out.push(`${name}="${escapeHtml(safe)}"`);
      continue;
    }
    if (name === 'style') {
      const st = sanitizeStyle(value);
      if (st) out.push(`style="${escapeHtml(st)}"`);
      continue;
    }
    if (['class', 'id', 'title', 'colspan', 'rowspan', 'width', 'height', 'align',
      'valign', 'border', 'cellpadding', 'cellspacing', 'charset', 'name',
      'rel', 'target', 'alt'].includes(name)) {
      if (name === 'target' && value !== '_blank') continue;
      // meta name=viewport content=… — allow content only with name=viewport
      out.push(`${name}="${escapeHtml(value)}"`);
    }
  }
  // Restore viewport meta content when name=viewport present
  if (tag === 'meta') {
    const nameAttr = /(?:^|\s)name\s*=\s*(?:"viewport"|'viewport'|viewport)/i.test(attrString || '');
    const contentMatch = /(?:^|\s)content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrString || '');
    if (nameAttr && contentMatch) {
      const content = contentMatch[1] != null ? contentMatch[1] : (contentMatch[2] != null ? contentMatch[2] : contentMatch[3]);
      if (content && !out.some((a) => a.startsWith('content='))) {
        out.push(`content="${escapeHtml(content)}"`);
      }
    }
  }
  if (tag === 'a' && out.some((a) => a.startsWith('href=')) && !out.some((a) => a.startsWith('rel='))) {
    out.push('rel="noopener noreferrer"');
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

/**
 * Sanitize HTML fragment or full email document for SMTP / preview.
 * @param {string} html
 * @returns {string}
 */
function sanitizeEmailHtml(html) {
  if (!html || typeof html !== 'string') return '';

  let out = html
    // Neutralize style block bodies before tag pass
    .replace(/<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi, (_, css) =>
      `<style type="text/css">${sanitizeCssBlock(css)}</style>`)
    // Remove script/iframe/object/embed/form/link/base entirely
    .replace(/<\s*(script|iframe|object|embed|form|link|base|img)[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|link|base|img)[^>]*\/?\s*>/gi, '');

  out = out.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (match, rawTag, attrs) => {
    const tag = String(rawTag).toLowerCase();
    const isClose = match.startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) {
      return '';
    }
    if (isClose) return `</${tag}>`;
    if (VOID_TAGS.has(tag)) {
      const a = sanitizeAttrs(tag, attrs || '');
      // Drop empty/useless meta (e.g. stripped refresh)
      if (tag === 'meta' && !a) return '';
      return `<${tag}${a}>`;
    }
    const selfClosing = /\/\s*>$/.test(match);
    return `<${tag}${sanitizeAttrs(tag, attrs || '')}${selfClosing ? ' /' : ''}>`;
  });

  return out;
}

module.exports = {
  escapeHtml,
  safeHttpUrl,
  sanitizeEmailHtml,
  sanitizeCssBlock,
};
