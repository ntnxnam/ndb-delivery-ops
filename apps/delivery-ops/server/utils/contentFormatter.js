/**
 * Format Confluence content to be more human-readable
 * Removes excessive HTML, formats tables, and structures content
 */

function formatConfluenceContent(htmlContent) {
  if (!htmlContent) return '';
  
  let formatted = htmlContent;
  
  // Remove excessive whitespace and newlines
  formatted = formatted.replace(/\s+/g, ' ');
  
  // Convert common HTML entities
  formatted = formatted.replace(/&nbsp;/g, ' ');
  formatted = formatted.replace(/&amp;/g, '&');
  formatted = formatted.replace(/&lt;/g, '<');
  formatted = formatted.replace(/&gt;/g, '>');
  formatted = formatted.replace(/&quot;/g, '"');
  
  // Remove script tags and their content
  formatted = formatted.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  // Remove style tags and their content
  formatted = formatted.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Convert headers to readable format
  formatted = formatted.replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, text) => {
    const prefix = '#'.repeat(parseInt(level));
    return `\n\n${prefix} ${cleanText(text)}\n`;
  });
  
  // Convert paragraphs
  formatted = formatted.replace(/<p[^>]*>(.*?)<\/p>/gi, (match, text) => {
    const clean = cleanText(text);
    return clean ? `\n${clean}\n` : '';
  });
  
  // Convert line breaks
  formatted = formatted.replace(/<br\s*\/?>/gi, '\n');
  formatted = formatted.replace(/<\/div>/gi, '\n');
  
  // Convert lists
  formatted = formatted.replace(/<ul[^>]*>/gi, '\n');
  formatted = formatted.replace(/<ol[^>]*>/gi, '\n');
  formatted = formatted.replace(/<\/ul>/gi, '\n');
  formatted = formatted.replace(/<\/ol>/gi, '\n');
  formatted = formatted.replace(/<li[^>]*>(.*?)<\/li>/gi, (match, text) => {
    return `  • ${cleanText(text)}\n`;
  });
  
  // Convert bold and italic
  formatted = formatted.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  formatted = formatted.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  formatted = formatted.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  formatted = formatted.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  
  // Convert links
  formatted = formatted.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)');
  
  // Convert tables to readable format
  formatted = formatTables(formatted);
  
  // Clean up remaining HTML tags
  formatted = formatted.replace(/<[^>]+>/g, '');
  
  // Clean up multiple newlines
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  
  // Trim whitespace
  formatted = formatted.trim();
  
  return formatted;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '') // Remove any remaining HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTables(html) {
  // Extract table content and format it
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let formatted = html;
  let match;
  
  while ((match = tableRegex.exec(html)) !== null) {
    const tableContent = match[1];
    const rows = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    
    let tableText = '\n\n--- Table ---\n';
    
    rows.forEach((row, index) => {
      const cells = row.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi) || [];
      if (cells.length > 0) {
        const cellTexts = cells.map(cell => {
          const cellMatch = cell.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/i);
          return cellMatch ? cleanText(cellMatch[1]) : '';
        }).filter(text => text.length > 0);
        
        if (cellTexts.length > 0) {
          tableText += cellTexts.join(' | ') + '\n';
          if (index === 0) {
            tableText += cellTexts.map(() => '---').join(' | ') + '\n';
          }
        }
      }
    });
    
    tableText += '---\n\n';
    formatted = formatted.replace(match[0], tableText);
  }
  
  return formatted;
}

/**
 * Format structured data (like the feature update content)
 */
function formatStructuredContent(content) {
  if (!content) return '';
  
  // Split by common delimiters and format
  let formatted = content;
  
  // First, remove table markers (--- Table ---, --- **Table ---, etc.) as they're not needed
  formatted = formatted.replace(/---\s*\*\*Table\s*---\*\*/g, '');
  formatted = formatted.replace(/---\s*\*\*Table\s*---/g, '');
  formatted = formatted.replace(/---\s*Table\s*---/g, '');
  formatted = formatted.replace(/---\s*\*\*/g, '');
  formatted = formatted.replace(/\*\*\s*---/g, '');
  
  // Remove standalone "---" lines (table separators) but keep them if they're part of headers
  formatted = formatted.replace(/^---\s*$/gm, '');
  formatted = formatted.replace(/\|\s*---\s*\|/g, '|');
  
  // Convert markdown headers to HTML FIRST (before ANY other formatting)
  // Handle multiple headers on the same line by splitting them
  // First, split lines that have multiple ## headers
  formatted = formatted.replace(/(##\s+[^#\n]+)(\s+##\s+)/g, '$1\n$2');
  
  // Now convert each header individually - match headers that don't contain HTML tags yet
  formatted = formatted.replace(/##\s+([^#<>\n]+?)(?:\s*---\s*|\s*$|$)/gm, (match, headerText) => {
    const cleanHeader = headerText.trim();
    if (!cleanHeader || cleanHeader.includes('<')) return match;
    return `<h2 style="margin-top: 1.5rem; margin-bottom: 0.75rem; color: #333; font-size: 1.3rem;">${cleanHeader}</h2>`;
  });
  formatted = formatted.replace(/###\s+([^#<>\n]+?)(?:\s*---\s*|\s*$|$)/gm, (match, headerText) => {
    const cleanHeader = headerText.trim();
    if (!cleanHeader || cleanHeader.includes('<')) return match;
    return `<h3 style="margin-top: 1.2rem; margin-bottom: 0.5rem; color: #444; font-size: 1.1rem;">${cleanHeader}</h3>`;
  });
  formatted = formatted.replace(/####\s+([^#<>\n]+?)(?:\s*---\s*|\s*$|$)/gm, (match, headerText) => {
    const cleanHeader = headerText.trim();
    if (!cleanHeader || cleanHeader.includes('<')) return match;
    return `<h4 style="margin-top: 1rem; margin-bottom: 0.5rem; color: #555;">${cleanHeader}</h4>`;
  });
  
  // Format status indicators with colors (after headers, before other formatting)
  // Match patterns like "GreenDONE", "Green Done", "Green DONE" (with or without space)
  formatted = formatted.replace(/Green\s*(DONE|Done)/gi, (match, status) => {
    return `<span style="color: #28a745; font-weight: bold;">DONE</span>`;
  });
  
  // Match patterns like "YellowIN PROGRESS", "Yellow IN PROGRESS", "Yellow In Progress"
  formatted = formatted.replace(/Yellow\s*(IN\s*PROGRESS|In\s*Progress)/gi, (match, status) => {
    return `<span style="color: #ffc107; font-weight: bold;">IN PROGRESS</span>`;
  });
  
  // Match patterns like "GreyNOT STARTED", "Grey NOT STARTED", "Grey Not Started"
  formatted = formatted.replace(/(Grey|Gray)\s*(NOT\s*STARTED|Not\s*Started)/gi, (match, color, status) => {
    return `<span style="color: #6c757d; font-weight: bold;">NOT STARTED</span>`;
  });
  
  // Format other status indicators (Green, Yellow, Grey) with emojis for text-only contexts
  formatted = formatted.replace(/(Green|Yellow|Grey)([A-Z][A-Z\s]+)/g, (match, color, status) => {
    // Skip if already formatted with HTML
    if (match.includes('<span')) return match;
    const emoji = color === 'Green' ? '✅' : color === 'Yellow' ? '🟡' : '⚪';
    return `${emoji} ${status.trim()}`;
  });
  
  
  // Format field labels (before converting bold)
  formatted = formatted.replace(/([A-Z][^:]+):\s*([^\n]+)/g, (match, label, value) => {
    // Skip if already contains HTML
    if (value.includes('<span') || value.includes('<strong>')) {
      return `<strong>${label.trim()}:</strong> ${value.trim()}`;
    }
    return `<strong>${label.trim()}:</strong> ${value.trim()}`;
  });
  
  // Convert markdown bold (**text** -> <strong>text</strong>)
  // But avoid matching if it's already inside HTML tags
  formatted = formatted.replace(/\*\*([^*<]+)\*\*/g, '<strong>$1</strong>');
  
  // Convert markdown italic (*text* -> <em>text</em>)
  formatted = formatted.replace(/\*([^*<]+)\*/g, '<em>$1</em>');
  
  // Don't replace JIRA queries here - they need to be kept for population
  // They will be replaced during population with actual counts
  // formatted = formatted.replace(/Jira\(([^)]+)\)/gi, (match, query) => {
  //   return `<br><em>JIRA Query:</em> ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}<br>`;
  // });
  
  // Convert line breaks to <br> tags (but preserve existing HTML structure)
  // Replace \n that are not already part of HTML tags
  formatted = formatted.replace(/\n(?!<[^>]*>)/g, '<br>');
  
  // Clean up multiple <br> tags (more than 2 consecutive)
  formatted = formatted.replace(/(<br>){3,}/g, '<br><br>');
  
  // Clean up <br> tags before closing HTML tags
  formatted = formatted.replace(/<br>\s*(<\/[^>]+>)/g, '$1');
  formatted = formatted.replace(/(<[^>]+>)\s*<br>/g, '$1');
  
  // Wrap in a container div for better styling
  formatted = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; padding: 1rem;">${formatted}</div>`;
  
  return formatted;
}

/**
 * Convert markdown-style tables to HTML tables
 */
function formatMarkdownTables(content) {
  // Pattern to match markdown tables
  const tableRegex = /---\s*Table\s*---([\s\S]*?)(?=---|##|$)/g;
  
  let formatted = content;
  let match;
  
  while ((match = tableRegex.exec(content)) !== null) {
    const tableContent = match[1].trim();
    const lines = tableContent.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      // Empty table, just remove the marker
      formatted = formatted.replace(match[0], '');
      continue;
    }
    
    // Check if it's a markdown table (has | separators)
    const isMarkdownTable = lines.some(line => line.includes('|'));
    
    if (isMarkdownTable) {
      let htmlTable = '<table style="border-collapse: collapse; width: 100%; margin: 1rem 0;">';
      
      lines.forEach((line, index) => {
        const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
        
        if (cells.length > 0) {
          const isHeader = index === 0 || line.includes('---');
          const tag = isHeader ? 'th' : 'td';
          
          if (!line.includes('---')) {
            htmlTable += `<tr>`;
            cells.forEach(cell => {
              htmlTable += `<${tag} style="border: 1px solid #ddd; padding: 8px; text-align: left;">${cell}</${tag}>`;
            });
            htmlTable += `</tr>`;
          }
        }
      });
      
      htmlTable += '</table>';
      formatted = formatted.replace(match[0], htmlTable);
    } else {
      // Not a markdown table, just remove the marker
      formatted = formatted.replace(match[0], tableContent);
    }
  }
  
  return formatted;
}

/**
 * Extract JIRA information from Confluence content
 * Parses lines like: FEAT Number	Jiraissuekey,summary,...FEAT-17939
 */
function extractJiraInfo(content) {
  if (!content) return [];
  
  const jiraInfo = [];
  const lines = content.split('\n');
  
  // Pattern to match JIRA key (e.g., FEAT-17939, ERA-4386, etc.)
  const jiraKeyPattern = /([A-Z]+-\d+)/g;
  
  lines.forEach((line, index) => {
    // Look for lines that contain JIRA keys
    const matches = line.match(jiraKeyPattern);
    
    if (matches && matches.length > 0) {
      // Check if this looks like a data row (contains commas or tabs)
      if (line.includes(',') || line.includes('\t')) {
        // Try to parse as CSV/TSV
        const parts = line.includes('\t') ? line.split('\t') : line.split(',');
        
        // Find JIRA key in the line
        const jiraKey = matches[0];
        
        // Try to find summary - usually after the key or in a specific column
        let summary = '';
        
        // Look for summary field - might be in different positions
        if (parts.length > 1) {
          // Summary is often the second field (index 1)
          summary = parts[1]?.trim() || '';
          
          // If summary contains the JIRA key, try to extract just the summary part
          if (summary.includes(jiraKey)) {
            summary = summary.replace(jiraKey, '').trim();
          }
          
          // If summary is empty or looks like a header, try other fields
          if (!summary || summary.toLowerCase().includes('summary') || summary === '') {
            // Try to find a field that looks like a summary (longer text, not a field name)
            for (let i = 2; i < parts.length; i++) {
              const field = parts[i]?.trim();
              if (field && field.length > 10 && !field.match(/^[a-z\s]+$/i)) {
                summary = field;
                break;
              }
            }
          }
        }
        
        // If we still don't have a summary, try to extract from the line itself
        if (!summary || summary.length < 5) {
          // Look for text between the key and common delimiters
          const keyIndex = line.indexOf(jiraKey);
          if (keyIndex > 0) {
            const beforeKey = line.substring(0, keyIndex).trim();
            const partsBefore = beforeKey.split(/[,\t]/);
            if (partsBefore.length > 0) {
              summary = partsBefore[partsBefore.length - 1].trim();
            }
          }
        }
        
        if (jiraKey) {
          jiraInfo.push({
            key: jiraKey,
            summary: summary || 'No summary available',
            line: index + 1
          });
        }
      }
    }
  });
  
  return jiraInfo;
}

/**
 * Format JIRA information for display
 */
function formatJiraInfo(jiraInfo) {
  if (!jiraInfo || jiraInfo.length === 0) return '';
  
  let formatted = '\n\n## JIRA Issues Found\n\n';
  
  jiraInfo.forEach((info, index) => {
    formatted += `${index + 1}. **${info.key}**: ${info.summary}\n`;
  });
  
  return formatted;
}

module.exports = {
  formatConfluenceContent,
  formatStructuredContent,
  extractJiraInfo,
  formatJiraInfo
};

