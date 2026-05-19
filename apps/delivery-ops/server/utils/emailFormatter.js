/**
 * Email Formatting Utilities
 * Centralized utilities for formatting content for email (HTML, JIRA wiki markup, etc.)
 */

const { JIRA_BASE_URL } = require('../config/api');

/**
 * Convert Quill HTML to clean HTML for email
 * Handles Quill's HTML output and sanitizes it for email clients
 * @param {string} quillHtml - HTML string from ReactQuill
 * @returns {string} Clean HTML string safe for email
 */
function convertQuillHtmlToEmail(quillHtml) {
  if (!quillHtml || typeof quillHtml !== 'string') return '';
  
  // If it's just whitespace or empty, return empty
  const trimmed = quillHtml.trim();
  if (!trimmed || trimmed === '<p><br></p>' || trimmed === '<p></p>') return '';
  
  // Quill outputs HTML, so we can use it directly but need to:
  // 1. Convert JIRA keys to links
  // 2. Ensure links are properly formatted
  // 3. Sanitize any dangerous content
  
  let html = trimmed;
  
  // Convert JIRA keys (e.g., FEAT-12345) to links
  html = html.replace(/([A-Z]+-\d+)/g, `<a href="${JIRA_BASE_URL}/browse/$1" style="color: #0065ff; text-decoration: none;">$1</a>`);
  
  // Ensure all links have proper styling
  html = html.replace(/<a\s+href="([^"]+)"([^>]*)>/g, (match, href, attrs) => {
    if (!attrs || !attrs.includes('style=')) {
      return `<a href="${href}" style="color: #0065ff; text-decoration: none;"${attrs}>`;
    }
    return match;
  });
  
  return html;
}

/**
 * Format content for email - handles both HTML (from Quill) and JIRA wiki markup
 * @param {string} content - Content string (HTML or JIRA wiki markup)
 * @returns {string} Formatted HTML string for email
 */
function formatContentForEmail(content) {
  if (!content || typeof content !== 'string') return '';
  
  const trimmed = content.trim();
  if (!trimmed) return '';
  
  // Check if it's HTML (from Quill) - contains HTML tags
  if (trimmed.includes('<') && (trimmed.includes('<p>') || trimmed.includes('<div>') || trimmed.includes('<strong>') || trimmed.includes('<em>'))) {
    // It's HTML from Quill, convert it
    return convertQuillHtmlToEmail(trimmed);
  }
  
  // Otherwise, treat as JIRA wiki markup and convert
  return formatJiraWikiMarkupForEmail(trimmed);
}

/**
 * Format JIRA wiki markup to HTML for email
 * @param {string} text - JIRA wiki markup text
 * @returns {string} HTML string
 */
function formatJiraWikiMarkupForEmail(text) {
  if (!text || typeof text !== 'string') return '';
  
  // Escape HTML first
  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Process line by line for block-level elements
  const lines = formatted.split('\n');
  const processedLines = [];
  let listStack = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // JIRA headings
    if (/^h[1-6]\.\s+(.+)$/i.test(trimmed)) {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      const match = trimmed.match(/^h([1-6])\.\s+(.+)$/i);
      const level = parseInt(match[1]);
      const headingText = match[2];
      processedLines.push(`<h${level} style="font-size: ${16 - (level - 1) * 2}px; font-weight: 600; margin: 15px 0 8px 0; color: #1a1a1a;">${headingText}</h${level}>`);
      continue;
    }
    
    // Numbered lists
    const orderedListMatch = trimmed.match(/^(#+)\s+(.+)$/);
    if (orderedListMatch) {
      const hashCount = orderedListMatch[1].length;
      const itemText = orderedListMatch[2];
      const targetLevel = hashCount;
      
      while (listStack.length > 0 && listStack[listStack.length - 1].level > targetLevel) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      
      while (listStack.length < targetLevel) {
        const currentLevel = listStack.length + 1;
        processedLines.push(`<ol style="margin: 6px 0; padding-left: ${20 + (currentLevel - 1) * 20}px;">`);
        listStack.push({ type: 'ordered', level: currentLevel });
      }
      
      processedLines.push(`<li style="margin: 4px 0;">${itemText}</li>`);
      continue;
    }
    
    // Bullet lists
    if (/^[\*\-]\s+(.+)$/.test(trimmed)) {
      while (listStack.length > 0 && listStack[listStack.length - 1].type === 'ordered') {
        const list = listStack.pop();
        processedLines.push('</ol>');
      }
      
      if (listStack.length === 0 || listStack[listStack.length - 1].type !== 'unordered') {
        processedLines.push('<ul style="margin: 8px 0; padding-left: 25px; list-style-type: disc;">');
        listStack.push({ type: 'unordered', level: 1 });
      }
      
      const itemText = trimmed.replace(/^[\*\-]\s+/, '');
      processedLines.push(`<li style="margin: 4px 0;">${itemText}</li>`);
      continue;
    }
    
    // Empty line
    if (trimmed === '') {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      processedLines.push('<br>');
      continue;
    }
    
    // Regular line
    if (listStack.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
    }
    
    processedLines.push(`<div style="margin-bottom: 6px;">${trimmed}</div>`);
  }
  
  while (listStack.length > 0) {
    const list = listStack.pop();
    processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
  }
  
  formatted = processedLines.join('');
  
  // Process inline formatting
  formatted = formatted.replace(/\{color:([^}]+)\}(.*?)\{color\}/g, (match, color, content) => {
    const colorMap = {
      'red': '#de350b',
      'green': '#00875a',
      'yellow': '#ff8b00',
      'blue': '#0052cc',
      'orange': '#ff8b00'
    };
    const colorValue = color.trim();
    let finalColor;
    if (colorMap[colorValue.toLowerCase()]) {
      finalColor = colorMap[colorValue.toLowerCase()];
    } else if (colorValue.startsWith('#')) {
      finalColor = colorValue;
    } else {
      finalColor = '#' + colorValue;
    }
    return `<span style="color: ${finalColor};">${content}</span>`;
  });
  
  // {*}bold{*} syntax (must be before bare *bold* to avoid partial matches)
  formatted = formatted.replace(/\{\*\}(.*?)\{\*\}/gs, '<strong>$1</strong>');
  // {-}strikethrough{-}
  formatted = formatted.replace(/\{-\}(.*?)\{-\}/gs, '<del style="text-decoration: line-through; color: #999;">$1</del>');
  // {+}underline{+}
  formatted = formatted.replace(/\{\+\}(.*?)\{\+\}/gs, '<u>$1</u>');
  // {_}italic{_}
  formatted = formatted.replace(/\{_\}(.*?)\{_\}/gs, '<em>$1</em>');

  // **bold** and *bold*
  formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/(?<!\*)\*([^*\n<]+)\*(?!\*)/g, '<strong>$1</strong>');

  // -strikethrough- (dash form, avoid list bullets and compound words)
  formatted = formatted.replace(/(?<!\w)-([^\-\n]{2,}?)-(?!\w)/g, '<del style="text-decoration: line-through; color: #999;">$1</del>');
  // _italic_ (underscore form)
  formatted = formatted.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<em>$1</em>');

  // JIRA links
  formatted = formatted.replace(/\[([^\]]+)\|([^\]]+)\]/g, '<a href="$2" style="color: #0065ff; text-decoration: none;">$1</a>');
  // JIRA issue keys
  formatted = formatted.replace(/([A-Z]+-\d+)/g, `<a href="${JIRA_BASE_URL}/browse/$1" style="color: #0065ff; text-decoration: none;">$1</a>`);
  
  return formatted;
}

/**
 * Convert Atlassian Document Format (ADF) to HTML for email
 * Jira Cloud returns description and other rich text as ADF: { type: 'doc', content: [...] }
 * @param {object} node - ADF node (doc, paragraph, text, etc.)
 * @param {string} jiraBaseUrl - Base URL for Jira (e.g. for issue keys)
 * @returns {string} HTML string
 */
function adfToHtml(node, jiraBaseUrl = 'https://jira.nutanix.com') {
  if (!node || typeof node !== 'object') return '';
  const escape = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const children = (nodes) => (Array.isArray(nodes) ? nodes : [])
    .map((n) => adfToHtml(n, jiraBaseUrl))
    .join('');

  switch (node.type) {
    case 'doc':
      return children(node.content);
    case 'paragraph':
      return `<p style="margin: 6px 0;">${children(node.content)}</p>`;
    case 'text': {
      let out = escape(node.text || '');
      (node.marks || []).forEach((mark) => {
        if (mark.type === 'strong') out = `<strong>${out}</strong>`;
        else if (mark.type === 'em') out = `<em>${out}</em>`;
        else if (mark.type === 'code') out = `<code style="background: #f4f5f7; padding: 0 4px;">${out}</code>`;
        else if (mark.type === 'link' && mark.attrs && mark.attrs.href) {
          const href = escape(mark.attrs.href);
          out = `<a href="${href}" style="color: #0065ff; text-decoration: none;">${out}</a>`;
        }
      });
      return out;
    }
    case 'hardBreak':
      return '<br>';
    case 'heading':
      const level = Math.min(6, Math.max(1, (node.attrs && node.attrs.level) || 1));
      return `<h${level} style="font-size: ${18 - level * 2}px; font-weight: 600; margin: 10px 0 6px 0;">${children(node.content)}</h${level}>`;
    case 'bulletList':
      return `<ul style="margin: 6px 0; padding-left: 20px;">${children(node.content)}</ul>`;
    case 'orderedList':
      return `<ol style="margin: 6px 0; padding-left: 20px;">${children(node.content)}</ol>`;
    case 'listItem':
      return `<li style="margin: 2px 0;">${children(node.content)}</li>`;
    case 'codeBlock':
      return `<pre style="margin: 8px 0; padding: 8px; background: #f4f5f7; overflow-x: auto;">${children(node.content)}</pre>`;
    case 'blockquote':
      return `<blockquote style="margin: 8px 0; padding-left: 16px; border-left: 3px solid #ddd; color: #555;">${children(node.content)}</blockquote>`;
    case 'panel':
      return `<div style="margin: 8px 0; padding: 10px; background: #f4f5f7;">${children(node.content)}</div>`;
    case 'rule':
      return '<hr style="margin: 12px 0; border: none; border-top: 1px solid #ddd;">';
    default:
      return children(node.content || []);
  }
}

/**
 * Detect if value is ADF (Jira Cloud rich text) and convert to HTML; otherwise return empty string
 * @param {*} value - Possible ADF doc object
 * @param {string} jiraBaseUrl - Base URL for Jira
 * @returns {string} HTML or empty string
 */
function formatAdfForEmail(value, jiraBaseUrl) {
  if (!value || typeof value !== 'object' || value.type !== 'doc' || !Array.isArray(value.content)) return '';
  return adfToHtml(value, jiraBaseUrl).trim() || '';
}

/**
 * Format a JIRA field value for display in email HTML table cell (Generic Emailer)
 * @param {*} value - Raw field value (user object, date string, link object, etc.)
 * @param {string} jiraBaseUrl - Base URL for JIRA links
 * @returns {string} - HTML-safe string for table cell
 */
function formatGenericEmailerCellValue(value, jiraBaseUrl = 'https://jira.nutanix.com') {
  if (value == null || value === undefined) return 'N/A';
  if (typeof value === 'string') {
    if (value.trim() === '') return 'N/A';
    return formatContentForEmail(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map(v => formatGenericEmailerCellValue(v, jiraBaseUrl)).filter(Boolean);
    const joined = parts.join(', ');
    return joined === '' ? 'N/A' : joined;
  }
  if (typeof value === 'object') {
    const adfHtml = formatAdfForEmail(value, jiraBaseUrl);
    if (adfHtml) return adfHtml;
    if (value.displayName || value.name || value.emailAddress || value.email || value.key) {
      const raw = (value.displayName || value.name || value.emailAddress || value.email || value.key || '').trim();
      if (raw === '') return 'N/A';
      return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    if (value.value != null) return formatGenericEmailerCellValue(value.value, jiraBaseUrl);
    if (value.name != null) return formatGenericEmailerCellValue(value.name, jiraBaseUrl);
    if (value.self && value.key) {
      const href = `${jiraBaseUrl}/browse/${value.key}`;
      const label = value.key + (value.fields?.summary ? ': ' + value.fields.summary : '');
      return `<a href="${href}" style="color: #0065ff;">${String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>`;
    }
    if (typeof value === 'object' && value.constructor?.name === 'Object') {
      const str = JSON.stringify(value);
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  }
  const str = String(value);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  convertQuillHtmlToEmail,
  formatContentForEmail,
  formatJiraWikiMarkupForEmail,
  adfToHtml,
  formatAdfForEmail,
  formatGenericEmailerCellValue
};

