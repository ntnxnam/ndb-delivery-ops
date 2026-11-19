import React from 'react';
import { getFieldValue, getFieldId } from '../../utils/jiraFields';
import { HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS } from '../../config/emailSenderFeatures';
import { MONTHS } from '../../shared/utils/dateFormatter';

export function ccDisplayLabel(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
}

// Strip HTML to plain text for validation
export function getPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// True if Quill/HTML content has no meaningful text
export function isHighlightsLowlightsEmpty(html) {
  return !getPlainText(html);
}

// Validate that all required sections are present (case-insensitive). Returns { valid, missingSections }.
export function validateHighlightsLowlightsSections(html) {
  const text = getPlainText(html).toLowerCase();
  const missingSections = HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS.filter(
    (section) => !text.includes(section.toLowerCase())
  );
  return { valid: missingSections.length === 0, missingSections };
}


/** Checklist links only — Risk Assessment / Path to Green render below Highlights. */
export const EXTRA_FETCH_FIELDS = [
  [getFieldId('cgChecklistLink'), 'Link to CG checklist'],
  [getFieldId('pgChecklistLink'), 'Link to PG checklist'],
];

function safeClientHttpUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return '';
  const lower = u.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || /localhost|127\.0\.0\.1/i.test(u)) {
    return '';
  }
  if (/^https?:\/\//i.test(u) || u.startsWith('/')) return u;
  return '';
}

export function renderFetchedFieldValue(value) {
  if (!value) return 'Not Set';
  if (typeof value === 'object' && value.type) {
    if (value.type === 'link' && value.url) {
      const href = safeClientHttpUrl(value.url);
      if (!href) return value.display || 'Link';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#0065ff', textDecoration: 'none' }}>
          {value.display || 'Link'}
        </a>
      );
    }
    return value.display || 'Not Set';
  }
  return typeof value === 'string' ? value : 'Not Set';
}

export function formatWeeklyUpdateDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  return `${day}/${month}/${date.getFullYear()}`;
}

export function buildWeeklyUpdateSubject({ issueType, summary, fixVersions }) {
  const release = String(fixVersions || '').trim();
  const releasePart = release && release !== 'N/A' ? ` - ${release}` : '';
  return `${issueType} - ${summary}${releasePart} - Weekly Update - ${formatWeeklyUpdateDate()}`;
}

export function formatJiraWikiMarkup(text, jiraBaseUrl) {
  if (!text || typeof text !== 'string') return '';
  
  // First, escape HTML to prevent XSS
  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Process line by line for block-level elements
  const lines = formatted.split('\n');
  const processedLines = [];
  let listStack = []; // Stack to track nested lists: [{type: 'ordered'|'unordered', level: number}, ...]
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // JIRA headings: h1., h2., h3., etc.
    if (/^h[1-6]\.\s+(.+)$/i.test(trimmed)) {
      // Close all open lists
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      const match = trimmed.match(/^h([1-6])\.\s+(.+)$/i);
      const level = parseInt(match[1]);
      const headingText = match[2];
      processedLines.push(`<h${level} style="font-size: ${24 - (level - 1) * 2}px; font-weight: 600; margin: 15px 0 8px 0; color: #1a1a1a;">${headingText}</h${level}>`);
      continue;
    }
    
    // Numbered list items: #, ##, ###, etc. (nested ordered lists)
    const orderedListMatch = trimmed.match(/^(#+)\s+(.+)$/);
    if (orderedListMatch) {
      const hashCount = orderedListMatch[1].length;
      const itemText = orderedListMatch[2];
      const targetLevel = hashCount;
      
      // Close lists that are deeper than current level (use > instead of >=)
      while (listStack.length > 0 && listStack[listStack.length - 1].level > targetLevel) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      
      // Open nested lists if needed
      while (listStack.length < targetLevel) {
        const currentLevel = listStack.length + 1;
        processedLines.push(`<ol style="margin: 6px 0; padding-left: ${20 + (currentLevel - 1) * 20}px;">`);
        listStack.push({ type: 'ordered', level: currentLevel });
      }
      
      processedLines.push(`<li style="margin: 4px 0;">${itemText}</li>`);
      continue;
    }
    
    // Bullet list items: * item or - item
    if (/^[*-]\s+(.+)$/.test(trimmed)) {
      // Close ordered lists if switching to unordered
      while (listStack.length > 0 && listStack[listStack.length - 1].type === 'ordered') {
        listStack.pop();
        processedLines.push('</ol>');
      }
      
      // Open unordered list if not already open
      if (listStack.length === 0 || listStack[listStack.length - 1].type !== 'unordered') {
        processedLines.push('<ul style="margin: 8px 0; padding-left: 25px; list-style-type: disc;">');
        listStack.push({ type: 'unordered', level: 1 });
      }
      
      const itemText = trimmed.replace(/^[-*]\s+/, '');
      processedLines.push(`<li style="margin: 4px 0;">${itemText}</li>`);
      continue;
    }
    
    // Empty line - close all lists
    if (trimmed === '') {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      processedLines.push('<br>');
      continue;
    }
    
    // Regular line - close all lists if not a continuation
    if (listStack.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
    }
    
    processedLines.push(`<div style="margin-bottom: 6px;">${trimmed}</div>`);
  }
  
  // Close any remaining open lists
  while (listStack.length > 0) {
    const list = listStack.pop();
    processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
  }
  
  formatted = processedLines.join('');
  
  // Process inline formatting
  // JIRA color markup: {color:#hex}text{color} or {color:red}text{color}
  // Use non-greedy matching to handle multiple color blocks and nested content
  formatted = formatted.replace(/\{color:([^}]+)\}(.*?)\{color\}/g, (match, color, content) => {
    const colorMap = {
      'deep red': '#8B0000',
      'red': '#de350b',
      'green': '#00875a',
      'yellow': '#ff8b00',
      'blue': '#0052cc',
      'orange': '#ff8b00'
    }
    // Trim color value and handle hex codes with or without #
    const colorValue = color.trim();
    let finalColor;
    if (colorMap[colorValue.toLowerCase()]) {
      finalColor = colorMap[colorValue.toLowerCase()];
    } else if (colorValue.startsWith('#')) {
      finalColor = colorValue;
    } else {
      // Assume it's a hex code without #
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
  formatted = formatted.replace(/\[([^\]]+)\|([^\]]+)\]/g, (_, label, url) => {
    const u = String(url || '').trim();
    const lower = u.toLowerCase();
    if (!u || lower.startsWith('javascript:') || lower.startsWith('data:') || /localhost|127\.0\.0\.1/i.test(u)) {
      return label;
    }
    if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) return label;
    return `<a href="${u}" style="color: #0065ff; text-decoration: none;" rel="noopener noreferrer" target="_blank">${label}</a>`;
  });
  formatted = formatted.replace(/\[([^\]]+)\]/g, '<span style="color: #0065ff;">$1</span>');
  
  // JIRA issue keys
  const base = String(jiraBaseUrl || '').replace(/\/$/, '');
  formatted = formatted.replace(/([A-Z]+-\d+)/g, `<a href="${base}/browse/$1" style="color: #0065ff; text-decoration: none;" rel="noopener noreferrer" target="_blank">$1</a>`);
  
  return formatted;
}
