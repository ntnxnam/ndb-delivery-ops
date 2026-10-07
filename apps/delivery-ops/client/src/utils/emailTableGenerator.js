/**
 * Email Table Generator
 * Generates HTML table strings for email from release version data
 * Reuses the same formatting logic as the UI but outputs HTML strings
 */

import { formatDateWithHistoryHTML } from './dateHistoryDisplay';

/**
 * Generate HTML table for email from release version items
 * @param {object} items - Items object with commit, longTermFunded, exploratory, etc. arrays
 * @param {object} checkpointHistory - Checkpoint history data
 * @param {string} selectedVersion - Selected release version
 * @param {object} columnsConfig - Column configuration with includeInEmail flags
 * @param {function} formatJiraWikiMarkup - Function to format JIRA wiki markup (from UI)
 * @param {function} extractExecutiveSummary - Function to extract executive summary (from UI)
 * @param {function} getExtensionLabelInfo - Function to get extension label info (from UI)
 * @param {function} getExtensionColor - Function to get extension color (from UI)
 * @param {string} jiraBaseUrl - JIRA base URL for constructing links
 * @param {object} sectionMetadata - Optional metadata about sections (from dynamic system)
 * @returns {string} HTML string for the tables
 */
export function generateTableHTMLForEmail(
  items,
  checkpointHistory,
  selectedVersion,
  columnsConfig,
  formatJiraWikiMarkup,
  extractExecutiveSummary,
  getExtensionLabelInfo,
  getExtensionColor,
  jiraBaseUrl = 'https://jira.nutanix.com',
  sectionMetadata = null
) {
  let html = '';

  // Get column order to match UI exactly - use includeInUI flag
  // This ensures email shows the same columns as the UI
  const emailColumnOrder = (columnsConfig?.columnOrder || []).filter(columnKey => {
    const col = columnsConfig?.columns?.[columnKey];
    return col && col.includeInUI !== false; // Use includeInUI to match UI exactly
  }).sort((a, b) => {
    const orderA = columnsConfig?.columns?.[a]?.order || 999;
    const orderB = columnsConfig?.columns?.[b]?.order || 999;
    return orderA - orderB;
  });

  // Helper to get column label
  const getColumnLabel = (columnKey) => {
    return columnsConfig?.columns?.[columnKey]?.label || columnKey;
  };

  // Helper to get column width
  const getColumnWidth = (columnKey) => {
    return columnsConfig?.columns?.[columnKey]?.width || '';
  };

  // Helper to escape HTML
  const escapeHtml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Helper to format team contacts in a single column (similar to checkpoint dates)
  const formatTeamContactsHTML = (item) => {
    const contacts = [
      { label: 'Assignee', value: item.assignee },
      { label: 'QA Contact', value: item.customfield_10860 },
      { label: 'PM Owner', value: item.customfield_11260 },
      { label: 'Program Mgr', value: item.customfield_27764 }
    ];

    // Helper to format user value
    const formatUserValue = (userValue) => {
      if (!userValue) return null;
      if (typeof userValue === 'string') return userValue;
      if (userValue.displayName) return userValue.displayName;
      if (userValue.name) return userValue.name;
      if (userValue.emailAddress) return userValue.emailAddress;
      return null;
    };

    let contactsHTML = '<div style="line-height: 1.8; font-size: 11px;">';
    contacts.forEach((contact, index) => {
      const userValue = formatUserValue(contact.value);
      contactsHTML += `<div style="margin-bottom: ${index < contacts.length - 1 ? '8px' : '0'};">
        <div style="font-weight: 600; color: #495057; margin-bottom: 2px; font-size: 10px;">
          ${escapeHtml(contact.label)}:
        </div>
        <div style="padding-left: 4px;">
          ${userValue ? escapeHtml(userValue) : '<span style="color: #999; font-style: italic;">Not Set</span>'}
        </div>
      </div>`;
    });
    contactsHTML += '</div>';

    return contactsHTML;
  };

  // Helper to format checkpoint dates as HTML
  const formatCheckpointDatesHTML = (item) => {
    const dates = [
      { label: 'FS/DS Done Date', field: 'fsdsDone', value: item.customfield_13861 },
      { label: 'Test Plan Date', field: 'testPlan', value: item.customfield_11068 },
      { label: 'Code Complete Date', field: 'codeComplete', value: item.customfield_11067 },
      { label: 'Commit Gate Ready Estimation Date', field: 'commitGate', value: item.customfield_35863 },
      { label: 'Promotion Gate Ready Estimation Date', field: 'promotionGate', value: item.customfield_35864 }
    ];

    const extensionInfo = getExtensionLabelInfo(item);

    // Normalize dates for comparison
    const normalizeDateForComparison = (dateValue) => {
      if (!dateValue) return null;
      try {
        if (typeof dateValue === 'string') {
          if (dateValue.includes('T')) {
            return new Date(dateValue);
          }
          const parts = dateValue.split(/[-/]/);
          if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
          }
        }
        if (dateValue instanceof Date) return dateValue;
        return null;
      } catch {
        return null;
      }
    };

    const fsdsDate = normalizeDateForComparison(item.customfield_13861);
    const testPlanDate = normalizeDateForComparison(item.customfield_11068);

    let fsdsHighlight = null;
    let testPlanHighlight = null;

    if (fsdsDate instanceof Date && testPlanDate instanceof Date) {
      const fsdsYear = fsdsDate.getFullYear();
      const fsdsMonth = fsdsDate.getMonth();
      const fsdsDay = fsdsDate.getDate();
      const testPlanYear = testPlanDate.getFullYear();
      const testPlanMonth = testPlanDate.getMonth();
      const testPlanDay = testPlanDate.getDate();

      if (fsdsYear === testPlanYear && fsdsMonth === testPlanMonth && fsdsDay === testPlanDay) {
        fsdsHighlight = 'yellow';
        testPlanHighlight = 'yellow';
      } else if (fsdsDate.getTime() > testPlanDate.getTime()) {
        fsdsHighlight = 'red';
        testPlanHighlight = 'red';
      }
    }

    let datesHTML = '<div style="line-height: 1.8; font-size: 11px;">';
    dates.forEach((date, index) => {
      let highlightStyle = '';
      if (date.field === 'fsdsDone' && fsdsHighlight) {
        highlightStyle = fsdsHighlight === 'red'
          ? 'border: 2px solid #de350b; border-radius: 4px; padding: 4px; background-color: #ffeaea;'
          : 'border: 2px solid #ffc107; border-radius: 4px; padding: 4px; background-color: #fffbf0;';
      } else if (date.field === 'testPlan' && testPlanHighlight) {
        highlightStyle = testPlanHighlight === 'red'
          ? 'border: 2px solid #de350b; border-radius: 4px; padding: 4px; background-color: #ffeaea;'
          : 'border: 2px solid #ffc107; border-radius: 4px; padding: 4px; background-color: #fffbf0;';
      }

      let extensionStyle = '';
      if (date.field === 'codeComplete' && extensionInfo) {
        const extensionColor = getExtensionColor(extensionInfo.dateStr);
        extensionStyle = `background-color: ${extensionColor.backgroundColor}; border: 2px solid ${extensionColor.borderColor}; border-radius: 4px; padding: 4px;`;
      }

      const combinedStyle = highlightStyle || extensionStyle;
      const styleAttr = combinedStyle ? ` style="${combinedStyle}"` : '';

      // Format date with history as HTML
      const dateHTML = formatDateWithHistoryHTML(item.key, date.field, date.value, checkpointHistory);

      datesHTML += `<div${styleAttr} style="margin-bottom: ${index < dates.length - 1 ? '8px' : '0'};${combinedStyle ? '' : ''}">
        <div style="font-weight: 600; color: #495057; margin-bottom: 2px; font-size: 10px;">${escapeHtml(date.label)}:</div>
        <div style="padding-left: 4px;">${dateHTML}</div>
      </div>`;
    });
    datesHTML += '</div>';
    return datesHTML;
  };

  // Helper to format cell value based on column type
  const formatCellValue = (item, columnKey) => {
    if (columnKey === 'key') {
      return `<a href="${jiraBaseUrl}/browse/${escapeHtml(item.key)}" style="color: #0065ff; text-decoration: none;">${escapeHtml(item.key)}</a>`;
    }
    if (columnKey === 'summary') {
      return escapeHtml(item.summary || 'N/A');
    }
    if (columnKey === 'status') {
      return escapeHtml(item.status || 'N/A');
    }
    if (columnKey === 'priority') {
      return escapeHtml(item.priority || 'N/A');
    }
    if (columnKey === 'fixVersion') {
      return escapeHtml(item.fixVersions || 'N/A');
    }
    if (columnKey === 'assignee') {
      return escapeHtml(item.assignee || 'N/A');
    }
    if (columnKey === 'qaContact') {
      // QA Contact is already extracted to string by backend
      return escapeHtml(item.customfield_10860 || 'N/A');
    }
    if (columnKey === 'tpmOwner') {
      return escapeHtml(item.customfield_27764 || 'N/A');
    }
    if (columnKey === 'teamContacts') {
      return formatTeamContactsHTML(item);
    }
    if (columnKey === 'checkpointDates') {
      return formatCheckpointDatesHTML(item);
    }
    if (columnKey === 'statusUpdate') {
      return ''; // Hidden
    }
    if (columnKey === 'riskIndicator') {
      const riskIndicator = item.customfield_23560;
      const riskValue = riskIndicator?.value || riskIndicator || 'Not Set';
      const riskColor = riskIndicator?.color || 'transparent';
      const isNotSet = !riskValue || riskValue === 'Not Set' || riskValue === 'N/A' || String(riskValue).trim() === '';
      
      let riskBgColor = 'transparent';
      let riskTextColor = 'inherit';
      let riskFontWeight = 'normal';
      
      if (isNotSet) {
        riskBgColor = '#fff3cd';
        riskFontWeight = '600';
      } else if (riskColor && riskColor !== 'transparent') {
        riskBgColor = riskColor;
        riskTextColor = '#ffffff';
        riskFontWeight = '600';
      } else if (typeof riskValue === 'string') {
        const colorMatch = String(riskValue).match(/^(Green|Yellow|Red|Blue|Orange)/i);
        if (colorMatch) {
          const colorName = colorMatch[1].toLowerCase();
          const colorMap = {
            'green': '#00875a',
            'yellow': '#ff8b00',
            'red': '#de350b',
            'blue': '#0052cc',
            'orange': '#ff8b00'
          };
          if (colorMap[colorName]) {
            riskBgColor = colorMap[colorName];
            riskTextColor = '#ffffff';
            riskFontWeight = '600';
          }
        }
      }
      return `<span style="background-color: ${riskBgColor}; color: ${riskTextColor}; font-weight: ${riskFontWeight}; padding: 2px 6px; border-radius: 2px;">${escapeHtml(isNotSet ? 'Not Set' : riskValue)}</span>`;
    }
    if (columnKey === 'executiveSummary') {
      return ''; // Hidden
    }
    if (columnKey === 'statusUpdate') {
      return ''; // Hidden
    }
    if (columnKey === 'executiveUpdate') {
      // Format executiveUpdate (customfield_38460) - same as customfield38460
      const executiveValue = item.customfield_38460;
      if (!executiveValue) {
        return 'Not Set';
      }
      // Handle string values
      if (typeof executiveValue === 'string') {
        // Use formatJiraWikiMarkup if available, otherwise escape HTML
        try {
          if (formatJiraWikiMarkup && typeof formatJiraWikiMarkup === 'function') {
            return formatJiraWikiMarkup(executiveValue, jiraBaseUrl);
          }
        } catch (e) {
          // Fallback to escaped HTML
        }
        return escapeHtml(executiveValue);
      }
      // Handle object values (extract value if it's an object)
      if (typeof executiveValue === 'object' && executiveValue.value) {
        const valueStr = String(executiveValue.value);
        try {
          if (formatJiraWikiMarkup && typeof formatJiraWikiMarkup === 'function') {
            return formatJiraWikiMarkup(valueStr, jiraBaseUrl);
          }
        } catch (e) {
          // Fallback to escaped HTML
        }
        return escapeHtml(valueStr);
      }
      return 'Not Set';
    }
    if (columnKey === 'customfield38460') {
      // Format customfield_38460 similar to statusUpdate
      if (!item.customfield_38460 || typeof item.customfield_38460 !== 'string') {
        return 'Not Set';
      }
      // Use formatJiraWikiMarkup if available, otherwise escape HTML
      try {
        // Try to use formatJiraWikiMarkup function if passed in
        if (formatJiraWikiMarkup && typeof formatJiraWikiMarkup === 'function') {
          return formatJiraWikiMarkup(item.customfield_38460, jiraBaseUrl);
        }
      } catch (e) {
        // Fallback to escaped HTML
      }
      return escapeHtml(item.customfield_38460);
    }
    if (
      columnKey === 'cgChecklistLink' ||
      columnKey === 'pgChecklistLink' ||
      columnKey === 'riskAssessment' ||
      columnKey === 'pathToGreen'
    ) {
      const fieldId = columnsConfig?.columns?.[columnKey]?.customField;
      const raw = fieldId ? item[fieldId] : null;
      const text = raw == null
        ? ''
        : (typeof raw === 'string' ? raw.trim() : String(raw.value || raw.url || raw.name || '').trim());
      if (!text || text === 'N/A' || text === 'NA' || text === 'Not Set') return 'Not Set';
      if (/^https?:\/\//i.test(text)) {
        return `<a href="${escapeHtml(text)}" style="color: #0065ff; text-decoration: none;">Link</a>`;
      }
      return escapeHtml(text);
    }
    if (columnKey === 'statusUpdateDate') {
      let statusUpdateDateValue = item.customfield_45660;
      if (statusUpdateDateValue && typeof statusUpdateDateValue === 'object' && !(statusUpdateDateValue instanceof Date)) {
        statusUpdateDateValue = statusUpdateDateValue.value || statusUpdateDateValue.date || statusUpdateDateValue;
      }
      if (!statusUpdateDateValue) {
        return 'Not Set';
      }
      try {
        const date = new Date(statusUpdateDateValue);
        if (!isNaN(date.getTime())) {
          const day = String(date.getDate()).padStart(2, '0');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = monthNames[date.getMonth()];
          const year = date.getFullYear();
          return `${day}/${month}/${year}`;
        }
      } catch {}
      return 'Not Set';
    }
    return 'N/A';
  };

  // Helper to format a single row
  const formatRowHTML = (item) => {
    // Check if row should be highlighted (Status Update Date > 10 days or empty)
    let statusUpdateDateValue = item.customfield_45660;
    if (statusUpdateDateValue && typeof statusUpdateDateValue === 'object' && !(statusUpdateDateValue instanceof Date)) {
      statusUpdateDateValue = statusUpdateDateValue.value || statusUpdateDateValue.date || statusUpdateDateValue;
    }
    const isStatusUpdateEmpty = !statusUpdateDateValue || statusUpdateDateValue === null || statusUpdateDateValue === undefined || String(statusUpdateDateValue).trim() === '';
    const isStatusUpdateOld = statusUpdateDateValue ? (() => {
      try {
        const date = new Date(statusUpdateDateValue);
        if (isNaN(date.getTime())) return false;
        const daysDiff = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
        return daysDiff > 10;
      } catch {
        return false;
      }
    })() : false;
    const shouldHighlightRow = isStatusUpdateEmpty || isStatusUpdateOld;
    const rowStyle = shouldHighlightRow ? 'border: 2px solid #de350b; box-shadow: 0 0 0 1px #de350b;' : '';

    // Build cells based on emailColumnOrder
    let cellsHTML = '';
    emailColumnOrder.forEach(columnKey => {
      const cellValue = formatCellValue(item, columnKey);
      const col = columnsConfig?.columns?.[columnKey];
      const isRiskIndicator = columnKey === 'riskIndicator';
      const isExecutiveSummary = columnKey === 'executiveSummary';
      const isKey = columnKey === 'key';
      const isCheckpointDates = columnKey === 'checkpointDates';
      const isStatusUpdate = columnKey === 'statusUpdate';
      
      let cellStyle = 'padding: 6px; border: 1px solid #dee2e6; vertical-align: top; word-wrap: break-word;';
      
      // Text alignment
      if (isRiskIndicator || (col && col.align === 'center')) {
        cellStyle += ' text-align: center;';
      } else {
        cellStyle += ' text-align: left;';
      }
      
      // Special styling for specific columns
      if (isExecutiveSummary) {
        cellStyle += ' font-size: 11px; line-height: 1.5;';
      }
      if (isStatusUpdate) {
        cellStyle += ' font-size: 12px; line-height: 1.5;';
      }
      if (isKey) {
        cellStyle += ' font-weight: 500;';
      }
      if (isCheckpointDates) {
        cellStyle += ' font-size: 11px;';
      }
      
      cellsHTML += `<td style="${cellStyle}">${cellValue}</td>`;
    });

    return `<tr style="${rowStyle}">${cellsHTML}</tr>`;
  };

  // Helper to generate table headers based on config
  const generateTableHeaders = () => {
    let headersHTML = '';
    emailColumnOrder.forEach(columnKey => {
      const col = columnsConfig?.columns?.[columnKey];
      const isRiskIndicator = columnKey === 'riskIndicator';
      const headerStyle = (isRiskIndicator || (col && col.align === 'center')) ? 'text-align: center;' : 'text-align: left;';
      const width = getColumnWidth(columnKey);
      const widthStyle = width ? `width: ${width};` : '';
      const label = getColumnLabel(columnKey);
      headersHTML += `<th style="padding: 8px; border: 1px solid #dee2e6; ${headerStyle} ${widthStyle} word-wrap: break-word;">${escapeHtml(label)}</th>`;
    });
    return headersHTML;
  };

  // Sort items (same as UI)
  const sortItems = (itemsList) => {
    return [...itemsList].sort((a, b) => {
      const keyA = a.key || '';
      const keyB = b.key || '';
      return keyA.localeCompare(keyB);
    });
  };

  // Generate sections dynamically - only show sections that exist with items
  let availableSections;

  if (sectionMetadata && sectionMetadata.isDynamic && sectionMetadata.sectionData) {
    // Use dynamic section metadata if available
    availableSections = Object.entries(sectionMetadata.sectionData).map(([key, data]) => ({
      key,
      name: data.name || key,
      items: items[key] || [],
      itemCount: data.itemCount || 0
    }));
    
    console.log(`[EmailTableGenerator] Using dynamic section metadata with ${availableSections.length} sections`);
  } else {
    // Fallback to legacy section mapping
    availableSections = [
      { key: 'commit', name: 'Commit', items: items.commit || [] },
      { key: 'longTermFunded', name: 'Long-term-funded', items: items.longTermFunded || [] },
      { key: 'exploratory', name: 'Exploratory', items: items.exploratory || [] },
      { key: 'extension', name: 'Extensions', items: items.extension || [] }
    ];
    
    console.log(`[EmailTableGenerator] Using legacy section mapping`);
  }

  // Filter to only sections with actual items and generate sequential numbering
  const sectionsWithItems = availableSections.filter(section => 
    section.items && Array.isArray(section.items) && section.items.length > 0
  );

  console.log(`[EmailTableGenerator] Generating ${sectionsWithItems.length} sections with items:`, 
    sectionsWithItems.map(s => `${s.name} (${s.items.length})`).join(', '));

  // Generate HTML for each section that has items
  sectionsWithItems.forEach((section, index) => {
    const sectionNumber = index + 1;
    const sectionName = section.name;
    const itemCount = section.items.length;
    
    html += `<h3 style="margin-top: 25px; margin-bottom: 12px; font-size: 14px; font-weight: 600; color: #2c3e50;">Section ${sectionNumber}: ${sectionName} (${itemCount})</h3>`;
    html += '<table style="width: 100%; max-width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 12px; table-layout: auto;">';
    html += '<thead><tr style="background-color: #e9ecef;">';
    const headersHTML = generateTableHeaders();
    html += headersHTML;
    html += '</tr></thead><tbody>';

    sortItems(section.items).forEach((item) => {
      html += formatRowHTML(item);
    });

    html += '</tbody></table>';
  });

  return html;
}

