/**
 * Release Version Table Utilities
 * Centralized utility functions for Release Version table rendering
 */

import React from 'react';

/**
 * Check if a date is older than specified days
 * @param {string|Date} dateValue - Date value to check
 * @param {number} days - Number of days threshold
 * @returns {boolean} True if date is older than threshold
 */
export function isDateOlderThan(dateValue, days) {
  if (!dateValue) return false;
  
  try {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    if (isNaN(date.getTime())) return false;
    
    const now = new Date();
    const diffTime = now - date;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > days;
  } catch (err) {
    console.error('Error checking date:', err);
    return false;
  }
}

/**
 * Get UI column order from config
 * @param {object} columnsConfig - Column configuration object
 * @returns {string[]} Array of column keys in UI order
 */
export function getUIColumnOrder(columnsConfig) {
  if (!columnsConfig || !columnsConfig.columns) return [];
  
  // If columnOrder array exists in config, use it and filter by includeInUI, then sort by order
  if (columnsConfig.columnOrder && Array.isArray(columnsConfig.columnOrder)) {
    return columnsConfig.columnOrder
      .filter(key => {
        const column = columnsConfig.columns[key];
        return column && column.includeInUI !== false;
      })
      .sort((a, b) => {
        const orderA = columnsConfig.columns[a]?.order || 999;
        const orderB = columnsConfig.columns[b]?.order || 999;
        return orderA - orderB;
      });
  }
  
  // Fallback: filter all columns and sort by order
  return Object.keys(columnsConfig.columns)
    .filter(key => columnsConfig.columns[key].includeInUI !== false)
    .sort((a, b) => {
      const orderA = columnsConfig.columns[a]?.order || 999;
      const orderB = columnsConfig.columns[b]?.order || 999;
      return orderA - orderB;
    });
}

/**
 * Get column label from config
 * @param {object} columnsConfig - Column configuration object
 * @param {string} columnKey - Column key
 * @returns {string} Column label
 */
export function getColumnLabel(columnsConfig, columnKey) {
  const column = columnsConfig?.columns?.[columnKey];
  if (!column) return columnKey;
  
  // Special handling for executive summary to show mode in label
  if (columnKey === 'executiveSummary' && column.mode) {
    const modeLabels = {
      'generated': 'Executive Summary (Generated)',
      'jira': 'Executive Summary (JIRA)',
      'both': 'Executive Summary'
    };
    return modeLabels[column.mode] || column.label || columnKey;
  }
  
  return column.label || columnKey;
}

/**
 * Get column width from config
 * @param {object} columnsConfig - Column configuration object
 * @param {string} columnKey - Column key
 * @returns {string} Column width (CSS value)
 */
export function getColumnWidth(columnsConfig, columnKey) {
  return columnsConfig?.columns?.[columnKey]?.width || '';
}

/**
 * Format JIRA wiki markup to HTML
 * @param {string} text - JIRA wiki markup text
 * @param {string} jiraBaseUrl - JIRA base URL for links
 * @returns {string} HTML string
 */
export function formatJiraWikiMarkup(text, jiraBaseUrl = 'https://jira.nutanix.com') {
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
      processedLines.push(`<h${level} style="font-size: ${24 - (level - 1) * 2}px; font-weight: 600; margin: 8px 0 4px 0; color: #1a1a1a;">${headingText}</h${level}>`);
      continue;
    }
    
    // Numbered list items: #, ##, ###, etc. (nested ordered lists)
    const orderedListMatch = trimmed.match(/^(#+)\s+(.+)$/);
    if (orderedListMatch) {
      const hashCount = orderedListMatch[1].length;
      const itemText = orderedListMatch[2];
      const targetLevel = hashCount;
      
      // Close lists that are deeper than current level
      while (listStack.length > 0 && listStack[listStack.length - 1].level > targetLevel) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      
      // Open nested lists if needed
      while (listStack.length < targetLevel) {
        const currentLevel = listStack.length + 1;
        processedLines.push(`<ol style="margin: 2px 0; padding-left: ${20 + (currentLevel - 1) * 20}px;">`);
        listStack.push({ type: 'ordered', level: currentLevel });
      }
      
      processedLines.push(`<li style="margin: 2px 0;">${itemText}</li>`);
      continue;
    }
    
    // Bullet list items: * item or - item
    if (/^[-*]\s+(.+)$/.test(trimmed)) {
      // Close ordered lists if switching to unordered
      while (listStack.length > 0 && listStack[listStack.length - 1].type === 'ordered') {
        listStack.pop();
        processedLines.push('</ol>');
      }
      
      // Open unordered list if not already open
      if (listStack.length === 0 || listStack[listStack.length - 1].type !== 'unordered') {
        processedLines.push('<ul style="margin: 2px 0; padding-left: 25px; list-style-type: disc;">');
        listStack.push({ type: 'unordered', level: 1 });
      }
      
      const itemText = trimmed.replace(/^[-*]\s+/, '');
      processedLines.push(`<li style="margin: 2px 0;">${itemText}</li>`);
      continue;
    }
    
    // Empty line - close all lists
    if (trimmed === '') {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
      // Skip empty lines to reduce whitespace
      continue;
    }
    
    // Regular line - close all lists if not a continuation
    if (listStack.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      while (listStack.length > 0) {
        const list = listStack.pop();
        processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
      }
    }
    
    processedLines.push(`<div style="margin: 0 0 2px 0; padding: 0;">${trimmed}</div>`);
  }
  
  // Close any remaining open lists
  while (listStack.length > 0) {
    const list = listStack.pop();
    processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
  }
  
  formatted = processedLines.join('');
  
  // Process inline formatting
  // JIRA color markup: {color:#hex}text{color} or {color:red}text{color}
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
  formatted = formatted.replace(/\[([^\]]+)\]/g, '<a href="#" style="color: #0065ff; text-decoration: none;">$1</a>');
  
  // JIRA issue keys
  formatted = formatted.replace(/([A-Z]+-\d+)/g, `<a href="${jiraBaseUrl}/browse/$1" style="color: #0065ff; text-decoration: none;">$1</a>`);
  
  return formatted;
}

/**
 * Extract executive summary from status update field
 * @param {string} statusUpdate - Status update field content
 * @returns {JSX.Element} Extracted executive summary as JSX
 */
export function extractExecutiveSummary(statusUpdate) {
  const renderNotSet = () => {
    return <span style={{ backgroundColor: '#fff3cd', fontWeight: 600 }}>Not Set</span>;
  };
  
  if (!statusUpdate || typeof statusUpdate !== 'string') return renderNotSet();
  
  // Remove JIRA wiki markup but preserve content
  let text = statusUpdate
    .replace(/\{color:[^}]+\}(.*?)\{color\}/g, '$1') // Extract text from color markup
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold markers but keep text
    .replace(/\[([^\]]+)\|([^\]]+)\]/g, '') // Remove links entirely
    .replace(/\[([^\]]+)\]/g, '') // Remove links without URL entirely
    .trim();
  
  // Split into lines and process
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length === 0) return renderNotSet();
  
  // Look for key patterns: dates, milestones, status indicators
  const datePattern = /\d{1,2}\/\w{3}\/\d{4}|\d{1,2}-\w{3}|\d{4}-\d{2}-\d{2}/i;
  const statusPattern = /(Done|In Progress|In progress|TBD|Not Done|Not Started|Completed|Blocked|At Risk)/i;
  const milestonePattern = /(PRD|Requirements|FS\/DS|Test Plan|Coding|Testing|QA|Milestone|Sprint|ETA)/i;
  
  // Extract meaningful sentences (not just first lines)
  const meaningfulLines = [];
  
  // First pass: Look for lines with dates, status, or milestones
  for (const line of lines) {
    if (meaningfulLines.length >= 2) break;
    
    const hasDate = datePattern.test(line);
    const hasStatus = statusPattern.test(line);
    const hasMilestone = milestonePattern.test(line);
    const isLongEnough = line.length > 20; // Skip very short lines
    
    // Prioritize lines with key information
    if ((hasDate || hasStatus || hasMilestone) && isLongEnough) {
      // Clean up the line
      let cleanLine = line
        .replace(/^h[1-6]\.\s+/i, '') // Remove heading markers
        .replace(/^#+\s+/, '') // Remove list markers
        .replace(/^[-*]\s+/, '') // Remove bullet markers
        .trim();
      
      if (cleanLine.length > 10) {
        meaningfulLines.push(cleanLine);
      }
    }
  }
  
  // Second pass: If we didn't find enough key info, take meaningful content
  if (meaningfulLines.length < 2) {
    for (const line of lines) {
      if (meaningfulLines.length >= 2) break;
      
      // Skip if already added
      if (meaningfulLines.includes(line.trim())) continue;
      
      // Skip very short lines, headings, or pure formatting
      const cleanLine = line
        .replace(/^h[1-6]\.\s+/i, '')
        .replace(/^#+\s+/, '')
        .replace(/^[-*]\s+/, '')
        .trim();
      
      // Look for substantial content (not just markers or single words)
      if (cleanLine.length > 30 && !cleanLine.match(/^[A-Z\s]+$/)) {
        meaningfulLines.push(cleanLine);
      }
    }
  }
  
  // If still not enough, take first substantial lines
  if (meaningfulLines.length < 2) {
    for (const line of lines) {
      if (meaningfulLines.length >= 2) break;
      const cleanLine = line
        .replace(/^h[1-6]\.\s+/i, '')
        .replace(/^#+\s+/, '')
        .replace(/^[-*]\s+/, '')
        .trim();
      
      if (cleanLine.length > 15 && !meaningfulLines.includes(cleanLine)) {
        meaningfulLines.push(cleanLine);
      }
    }
  }
  
  // Format the summary: limit each line to ~100 characters for better readability
  const summaryLines = meaningfulLines.slice(0, 2).map(line => {
    // Remove excessive whitespace and clean up
    let cleaned = line
      .replace(/\s+/g, ' ')
      .replace(/\{[^}]+\}/g, '') // Remove any remaining JIRA markup
      .trim();
    
    // Capitalize first letter for better presentation
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    
    if (cleaned.length > 100) {
      // Try to break at a sentence boundary
      const sentenceMatch = cleaned.substring(0, 100).match(/[.!?]/);
      if (sentenceMatch && sentenceMatch.index > 60) {
        return cleaned.substring(0, sentenceMatch.index + 1);
      }
      // Try to break at a word boundary
      const wordMatch = cleaned.substring(0, 97).match(/\s+\S*$/);
      if (wordMatch && wordMatch.index > 60) {
        return cleaned.substring(0, wordMatch.index) + '...';
      }
      return cleaned.substring(0, 97) + '...';
    }
    return cleaned;
  });
  
  if (summaryLines.length === 0) return renderNotSet();
  
  // Get full cleaned text for tooltip (also remove links)
  const fullText = statusUpdate
    .replace(/\{color:[^}]+\}(.*?)\{color\}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\|([^\]]+)\]/g, '') // Remove links entirely
    .replace(/\[([^\]]+)\]/g, '') // Remove links without URL entirely
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Format as two lines with better visual separation
  return (
    <div 
      title={fullText.length > summaryLines.join(' ').length ? fullText : undefined}
      style={{ 
        fontSize: '12px', 
        lineHeight: '1.5',
        color: '#212529',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        cursor: fullText.length > summaryLines.join(' ').length ? 'help' : 'default'
      }}
    >
      {summaryLines.map((line, idx) => (
        <div 
          key={idx} 
          style={{ 
            marginBottom: idx < summaryLines.length - 1 ? '6px' : '0',
            paddingBottom: idx < summaryLines.length - 1 ? '4px' : '0',
            borderBottom: idx < summaryLines.length - 1 ? '1px solid #e9ecef' : 'none'
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * Check if item has any label ending with "code-complete-extension-recieved"
 * @param {object} item - JIRA item object
 * @returns {boolean} True if any label ends with the extension suffix
 */
export function hasCodeCompleteExtensionLabel(item) {
  if (!item || !item.labels) {
    return false;
  }
  
  // Handle labels - can be array, comma-separated string, or space-separated
  let labels = [];
  if (Array.isArray(item.labels)) {
    labels = item.labels;
  } else if (typeof item.labels === 'string') {
    // Try comma-separated first, then space-separated
    labels = item.labels.includes(',') 
      ? item.labels.split(',').map(l => l.trim())
      : item.labels.split(/\s+/).map(l => l.trim());
  }
  
  // Check if any label ends with "code-complete-extension-recieved" (case-insensitive)
  // Note: "extension" is the correct spelling (not "extention")
  const extensionSuffix = 'code-complete-extension-recieved';
  
  for (const label of labels) {
    if (!label) continue;
    const labelLower = String(label).toLowerCase().trim();
    if (labelLower.endsWith(extensionSuffix)) {
      return true;
    }
  }
  return false;
}

/**
 * Get extension label info for an item (backward compatibility)
 * @param {object} item - JIRA item object
 * @param {string} selectedVersion - Selected release version (e.g., 'NDB-2.11')
 * @returns {object|null} Extension label info { hasExtension } or null
 */
export function getExtensionLabelInfo(item, _selectedVersion) {
  const hasExtension = hasCodeCompleteExtensionLabel(item);
  if (hasExtension) {
    return {
      hasExtension: true
    };
  }
  return null;
}

/**
 * Get extension color - returns a single color for all extension labels
 * @param {string} dateStr - Optional date string (not used, kept for backward compatibility)
 * @returns {object} Color object { backgroundColor, borderColor }
 */
export function getExtensionColor(_dateStr) {
  // Use a single color for all extension labels - darker orange for better visibility
  return {
    backgroundColor: '#ffcc80', // Darker orange background for better visibility
    borderColor: '#ff9800'     // Orange border
  };
}

/**
 * Render "Not Set" indicator
 * @returns {JSX.Element} Not Set indicator
 */
export function renderNotSet() {
  return <span style={{ backgroundColor: '#fff3cd', fontWeight: 600 }}>Not Set</span>;
}

/**
 * Format date to dd/MMM/yyyy format
 * @param {string|Date} dateValue - Date value to format
 * @returns {string|JSX.Element} Formatted date or "Not Set"
 */
export function formatDate(dateValue) {
  if (!dateValue) return renderNotSet();
  
  let date;
  if (typeof dateValue === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
      date = new Date(dateValue);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      date = new Date(dateValue + 'T00:00:00');
    } else {
      date = new Date(dateValue);
    }
  } else if (dateValue instanceof Date) {
    date = dateValue;
  } else {
    return renderNotSet();
  }
  
  if (isNaN(date.getTime())) {
    return renderNotSet();
  }
  
  const day = String(date.getDate()).padStart(2, '0'); // Zero-padded: 05 instead of 5
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  
  return `${day}/${month}/${year}`;
}

/**
 * Normalize date for comparison
 * @param {string|Date} dateValue - Date value to normalize
 * @returns {Date|null} Normalized Date object or null
 */
export function normalizeDateForComparison(dateValue) {
  if (!dateValue) return null;
  
  try {
    let date;
    if (typeof dateValue === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
        date = new Date(dateValue);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        date = new Date(dateValue + 'T00:00:00');
      } else {
        date = new Date(dateValue);
      }
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else {
      return null;
    }
    
    if (isNaN(date.getTime())) {
      return null;
    }
    
    return date;
  } catch (err) {
    console.error('Error normalizing date:', err);
    return null;
  }
}

