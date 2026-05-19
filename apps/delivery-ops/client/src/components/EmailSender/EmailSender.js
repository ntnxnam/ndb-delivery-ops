import React, { useState, useRef, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { authenticatedPost } from '../../utils/api';
import { useJiraConfig } from '../../utils/jiraConfig';
import { HIGHLIGHTS_LOWLIGHTS_TEMPLATE, HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS } from '../../config/emailSenderFeatures';
import OutlookFallback from '../shared/OutlookFallback';
import './EmailSender.css';

// Strip HTML to plain text for validation
function getPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// True if Quill/HTML content has no meaningful text
function isHighlightsLowlightsEmpty(html) {
  return !getPlainText(html);
}

// Validate that all required sections are present (case-insensitive). Returns { valid, missingSections }.
function validateHighlightsLowlightsSections(html) {
  const text = getPlainText(html).toLowerCase();
  const missingSections = HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS.filter(
    (section) => !text.includes(section.toLowerCase())
  );
  return { valid: missingSections.length === 0, missingSections };
}

function EmailSender({ onLogout: _onLogout }) {
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailRecipientsError, setEmailRecipientsError] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [jiraKey, setJiraKey] = useState('');
  const [validatingJira, setValidatingJira] = useState(false);
  const [jiraValidationStatus, setJiraValidationStatus] = useState(null);
  const [fetchingJira, setFetchingJira] = useState(false);
  const [jiraData, setJiraData] = useState(null);
  const [fetchingEpics, setFetchingEpics] = useState(false);
  const [epics, setEpics] = useState(null);
  const [fetchingBreakdown, setFetchingBreakdown] = useState(false);
  const [issueBreakdown, setIssueBreakdown] = useState(null);
  const [sprintGanttData, setSprintGanttData] = useState(null);
  const [fetchingSprintGantt, setFetchingSprintGantt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [attachPdf, setAttachPdf] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const quillRef = useRef(null);

  // JIRA configuration
  const { jiraBaseUrl } = useJiraConfig();

  // Load credentials from localStorage (stored securely from auth screen)
  // NOTE: System uses username format (e.g., 'namratha.singh') not email format
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const jiraToken = localStorage.getItem('jiraToken') || '';

  // Prepopulate Highlights and Lowlights (Additional Details) with template when JIRA data is first loaded
  useEffect(() => {
    if (jiraData && isHighlightsLowlightsEmpty(additionalDetails)) {
      setAdditionalDetails(HIGHLIGHTS_LOWLIGHTS_TEMPLATE);
    }
  }, [!!jiraData]); // eslint-disable-line react-hooks/exhaustive-deps -- only when jiraData becomes truthy

  // Helper to normalize username to email format
  const normalizeToEmail = (input) => {
    if (!input) return null;
    const trimmed = String(input).trim().toLowerCase();
    
    // If already an email, validate it's nutanix.com
    if (trimmed.includes('@')) {
      if (trimmed.endsWith('@nutanix.com')) {
        return trimmed;
      }
      // If different domain, extract username and add @nutanix.com
      const username = trimmed.split('@')[0];
      return `${username}@nutanix.com`;
    }
    
    // If it's just a username, add @nutanix.com
    return `${trimmed}@nutanix.com`;
  };

  // Validate email or username format
  const isValidEmailOrUsername = (input) => {
    if (!input) return false;
    const trimmed = input.trim();
    
    // Username format: alphanumeric, dots, hyphens, underscores
    const usernameRegex = /^[a-z0-9._-]+$/i;
    
    // Email format: user@domain
    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    
    // Check if it's a valid username (no @) or valid email
    if (trimmed.includes('@')) {
      return emailRegex.test(trimmed);
    } else {
      return usernameRegex.test(trimmed);
    }
  };

  // Validate and normalize email recipients
  const validateEmailRecipients = (value) => {
    if (!value || !value.trim()) {
      setEmailRecipientsError('');
      return true;
    }

    const recipients = value.split(';').map(r => r.trim()).filter(r => r);
    
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      if (!isValidEmailOrUsername(recipient)) {
        setEmailRecipientsError(`Invalid format at position ${i + 1}: "${recipient}". Please enter a valid Nutanix email (e.g., user@nutanix.com) or username (e.g., user.name).`);
        return false;
      }
    }
    
    setEmailRecipientsError('');
    return true;
  };

  // Normalize email recipients (convert usernames to emails)
  const normalizeEmailRecipients = (value) => {
    if (!value || !value.trim()) return '';
    
    const recipients = value.split(';').map(r => r.trim()).filter(r => r);
    const normalized = recipients.map(recipient => {
      return normalizeToEmail(recipient);
    }).filter(email => email);
    
    return normalized.join('; ');
  };

  // Helper function to format JIRA wiki markup to HTML
  const formatJiraWikiMarkup = (text) => {
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
        'red': '#de350b',
        'green': '#00875a',
        'yellow': '#ff8b00',
        'blue': '#0052cc',
        'orange': '#ff8b00'
      };
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
    formatted = formatted.replace(/\[([^\]]+)\|([^\]]+)\]/g, '<a href="$2" style="color: #0065ff; text-decoration: none;">$1</a>');
    formatted = formatted.replace(/\[([^\]]+)\]/g, '<a href="#" style="color: #0065ff; text-decoration: none;">$1</a>');
    
    // JIRA issue keys
    formatted = formatted.replace(/([A-Z]+-\d+)/g, `<a href="${jiraBaseUrl}/browse/$1" style="color: #0065ff; text-decoration: none;">$1</a>`);
    
    return formatted;
  };

  // Clear all JIRA-related data when jiraKey changes
  useEffect(() => {
    if (!jiraKey.trim()) {
      // If jiraKey is cleared, clear all related state
      setJiraData(null);
      setEpics(null);
      setIssueBreakdown(null);
      setSprintGanttData(null);
      setJiraValidationStatus(null);
      setEmailSubject('');
    }
  }, [jiraKey]);


  const validateJiraKey = async () => {
    if (!jiraKey.trim()) {
      setJiraValidationStatus({ valid: false, message: 'JIRA key is required' });
      return false;
    }

    if (!jiraToken) {
      setJiraValidationStatus({ valid: false, message: 'JIRA token required for validation' });
      return false;
    }

    setValidatingJira(true);
    setJiraValidationStatus(null);
    setError('');

    try {
      const response = await authenticatedPost('/api/jira/validate', {
        jiraKey: jiraKey.trim()
      }, { jiraToken, username });

      setJiraValidationStatus({
        valid: true,
        message: `Valid: ${response.data.issueType} - ${response.data.summary}`
      });
      
      // Auto-populate email subject line with current date
      if (response.data.issueType && response.data.summary) {
        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[today.getMonth()];
        const year = today.getFullYear();
        const dateStr = `${day}/${month}/${year}`;
        const subject = `${response.data.issueType} - ${response.data.summary} - Weekly Update - ${dateStr}`;
        setEmailSubject(subject);
      }
      
      return true;
    } catch (err) {
      console.error('JIRA validation error:', err);
      console.error('Error response:', err.response?.data);
      
      // Provide more helpful error messages based on error type (prefer server body over axios message)
      let errorMsg = err.response?.data?.error || err.response?.data?.message || 'Failed to validate JIRA key';
      const errorDetails = err.response?.data?.details;
      const errorMessage = err.response?.data?.message;
      if (err.response?.status === 500 && errorMsg === 'Failed to validate JIRA key' && err.message) {
        errorMsg = err.message.includes('status code 500')
          ? 'Server error (500). Check server logs for details.'
          : err.message;
      }
      
      // Handle specific error types
      if (err.response?.status === 429) {
        errorMsg = 'Rate limit exceeded. Please wait 30-60 seconds and try again.';
      } else if (err.response?.status === 404) {
        errorMsg = `JIRA ticket "${jiraKey.trim()}" not found. Please verify the ticket key.`;
      } else if (err.response?.status === 401) {
        errorMsg = 'JIRA authentication failed. Please check your JIRA token and try logging in again.';
      } else if (err.response?.status === 403) {
        errorMsg = 'Access forbidden. You may not have permission to view this ticket.';
      } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
        errorMsg = 'Unable to connect to JIRA. Please check your network connection.';
      }
      
      // If there are details, include them in the message
      if (errorDetails && Array.isArray(errorDetails) && errorDetails.length > 0) {
        errorMsg = `${errorMsg}\n\n${errorDetails.join('\n• ')}`;
      } else if (errorMessage && errorMessage !== errorMsg) {
        errorMsg = `${errorMsg}\n\n${errorMessage}`;
      }
      
      // Add network error handling
      if (err.code === 'ECONNREFUSED' || err.message.includes('Network Error')) {
        errorMsg = 'Cannot connect to server. Please ensure the backend server is running.';
      } else if (!err.response) {
        errorMsg = `Network error: ${err.message}`;
      }
      
      setJiraValidationStatus({
        valid: false,
        message: errorMsg
      });
      return false;
    } finally {
      setValidatingJira(false);
    }
  };

  const fetchJiraData = async () => {
    if (!jiraKey.trim()) {
      setError('JIRA key is required');
      return;
    }

    if (!jiraToken || !username) {
      setError('JIRA credentials required to fetch ticket data');
      return;
    }

    // First validate the JIRA key
    const isValid = await validateJiraKey();
    if (!isValid) {
      // Validation failed, error already set by validateJiraKey
      return;
    }

    setFetchingJira(true);
    setError('');
    // Clear all JIRA-related data when fetching new ticket
    setJiraData(null);
    setEpics(null);
    setIssueBreakdown(null);
    setSprintGanttData(null);

    try {
      const response = await authenticatedPost('/api/jira/fetch', {
        jiraKey: jiraKey.trim()
      }, { jiraToken, username });

      if (response.data.success && response.data.data) {
        setJiraData(response.data.data);
        
        // Mark validation as valid since fetch succeeded (fetch implies validation passed)
        if (!jiraValidationStatus || !jiraValidationStatus.valid) {
          setJiraValidationStatus({
            valid: true,
            message: `Valid: ${response.data.data.issueType || 'Unknown'} - ${response.data.data.summary || 'N/A'}`
          });
        }
        
        // Auto-populate email subject line from fetched data with current date
        if (response.data.data.issueType && response.data.data.summary) {
          const today = new Date();
          const day = String(today.getDate()).padStart(2, '0');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = monthNames[today.getMonth()];
          const year = today.getFullYear();
          const dateStr = `${day}/${month}/${year}`;
          const subject = `${response.data.data.issueType} - ${response.data.data.summary} - Weekly Update - ${dateStr}`;
          setEmailSubject(subject);
        }
        
        setSuccess('JIRA ticket data fetched successfully');
        setError('');
        
        // Automatically fetch epics (which now includes issue breakdown) after JIRA data is fetched
        if (jiraToken) {
          fetchEpics();
          fetchSprintGanttData();
        }
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (err) {
      console.error('Error fetching JIRA data:', err);
      let errorMsg = err.response?.data?.error ||
                    err.response?.data?.message ||
                    err.message ||
                    'Failed to fetch JIRA ticket data';
      if (err.response?.status === 500 && err.message?.includes('status code 500') && !err.response?.data?.error && !err.response?.data?.message) {
        errorMsg = 'Server error (500) while fetching ticket. Check server logs for details.';
      }
      setError(errorMsg);
      setJiraData(null);
      setSuccess('');
    } finally {
      setFetchingJira(false);
    }
  };

  const fetchEpics = async () => {
    if (!jiraKey.trim() || !jiraToken) {
      return;
    }

    setFetchingEpics(true);
    setEpics(null);

    try {
      // OPTIMIZATION: Pass already-fetched jiraData to avoid redundant API call
      // Using the renamed endpoint: fetch-all-jira-tickets (formerly fetch-epics)
      const response = await authenticatedPost('/api/jira/fetch-all-jira-tickets', {
        jiraKey: jiraKey.trim(),
        jiraData: jiraData || undefined  // Pass cached data if available
      }, { jiraToken, username });

      if (response.data.success) {
        setEpics(response.data.epics);
        
        // Also set issue breakdown if it's included in the response
        if (response.data.issueBreakdown) {
          setIssueBreakdown(response.data.issueBreakdown);
        } else {
          // If no breakdown data, set to null to clear previous data
          setIssueBreakdown(null);
        }
        // Clear fetchingBreakdown state since we're done
        setFetchingBreakdown(false);
      } else {
        console.warn('Failed to fetch epics:', response.data.error);
        setFetchingBreakdown(false);
      }
    } catch (err) {
      console.warn('Error fetching epics:', err.message);
      // Don't show error to user - this is supplementary data
      setFetchingBreakdown(false);
    } finally {
      setFetchingEpics(false);
    }
  };

  // Reserved for future use (e.g. manual refresh of issue breakdown)
  // eslint-disable-next-line no-unused-vars
  const _fetchIssueBreakdown = async () => {
    if (!jiraKey.trim() || !jiraToken) {
      return;
    }

    setFetchingBreakdown(true);
    setIssueBreakdown(null);

    try {
      const response = await authenticatedPost('/api/jira/issue-breakdown', {
        jiraKey: jiraKey.trim()
      }, { jiraToken, username });

      if (response.data.success) {
        setIssueBreakdown(response.data);
      } else {
        console.warn('Failed to fetch issue breakdown:', response.data.error);
      }
    } catch (err) {
      console.warn('Error fetching issue breakdown:', err.message);
      // Don't show error to user - this is supplementary data
    } finally {
      setFetchingBreakdown(false);
    }
  };

  const handleSend = async () => {
    if (isHighlightsLowlightsEmpty(additionalDetails)) {
      setError('Highlights and Lowlights is required');
      return;
    }
    const sectionValidation = validateHighlightsLowlightsSections(additionalDetails);
    if (!sectionValidation.valid) {
      setError(
        'Highlights and Lowlights must include all sections. Missing: ' +
        sectionValidation.missingSections.join('; ')
      );
      return;
    }
    if (!jiraKey.trim()) {
      setError('JIRA key is required');
      return;
    }

    // Validate JIRA key before sending (only if credentials are provided)
    // If no credentials, backend will validate if it receives them
    if (jiraToken && username) {
      // Check if ticket data has been fetched - if not, suggest fetching first
      if (!jiraData) {
        setError('Please fetch the ticket data using the "Fetch JIRA Data" button before sending email.');
        return;
      }
      
      // If we already have jiraData, the key was already validated during fetch
      // Only re-validate if validation status is missing or invalid
      // This avoids redundant API calls and potential rate limiting issues
      if (!jiraValidationStatus || !jiraValidationStatus.valid) {
        const isValid = await validateJiraKey();
        if (!isValid) {
          const validationError = jiraValidationStatus?.message || 'JIRA key validation failed. Please check the JIRA key and try again.';
          setError(validationError);
          return;
        }
      }
    }

    // Validate email recipients before sending (only if provided)
    if (emailRecipients && emailRecipients.trim() && !validateEmailRecipients(emailRecipients)) {
      setError('Please fix the Additional Recipients field before sending.');
      return;
    }
    
    // Normalize email recipients (convert usernames to emails) - optional field
    const normalizedRecipients = emailRecipients && emailRecipients.trim() 
      ? normalizeEmailRecipients(emailRecipients)
      : '';

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await authenticatedPost('/api/email/send', {
        executiveSummary: '', // Deprecated: narrative is in additionalDetails (Highlights and Lowlights)
        additionalDetails,
        emailRecipients: normalizedRecipients,
        emailSubject: emailSubject || undefined,
        jiraKey: jiraKey.trim(),
        jiraData: jiraData || undefined,
        epics: epics || undefined,
        issueBreakdown: issueBreakdown || undefined,
        attachPdf: attachPdf,
        isTest: testMode,
        dryRun: dryRun
      }, { jiraToken, username });

      if (response.data.dryRun) {
        setSuccess('Dry run: email was not sent.');
      } else if (response.data.isTestMode) {
        setSuccess('Test mode: email sent only to you.');
      } else {
        setSuccess(`Email sent successfully to ${response.data.recipients.length} recipient(s)!`);
        setTimeout(() => {
          handleClearAll();
          setAttachPdf(false);
        }, 2000);
      }
    } catch (err) {
      const sendError = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to send email. Please try again.';
      setError(err.response?.status === 500 && err.message?.includes('status code 500') && !err.response?.data?.error && !err.response?.data?.message
        ? 'Server error (500) while sending. Check server logs for details.'
        : sendError);
      // Don't close modal on error so user can see the error message
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = () => {
    setAdditionalDetails('');
    setEmailRecipients('');
    setEmailSubject('');
    setJiraKey('');
    setJiraValidationStatus(null);
    setJiraData(null);
    setEpics(null);
    setIssueBreakdown(null);
    setSprintGanttData(null);
    setError('');
    setSuccess('');
  };

  const fetchSprintGanttData = async () => {
    if (!jiraKey.trim() || !jiraToken) {
      return;
    }

    setFetchingSprintGantt(true);
    setSprintGanttData(null);

    try {
      const response = await authenticatedPost('/api/jira/sprint-gantt-data', {
        jiraKey: jiraKey.trim(),
        jiraData: jiraData || undefined,
        epics: epics || undefined
      }, { jiraToken, username });

      if (response.data.success) {
        setSprintGanttData(response.data);
      } else {
        console.warn('Failed to fetch sprint Gantt data:', response.data.error);
      }
    } catch (err) {
      console.warn('Error fetching sprint Gantt data:', err.message);
      // Don't show error to user - this is supplementary data
    } finally {
      setFetchingSprintGantt(false);
    }
  };

  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['link'],
      ['clean']
    ]
  };

  return (
    <div className="email-sender">
      <div className="card">

        <div className="form-group">
          <label htmlFor="jira-key">JIRA FEAT Key *</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <input
              type="text"
              id="jira-key"
              value={jiraKey}
              onChange={(e) => {
                setJiraKey(e.target.value);
                setJiraValidationStatus(null);
                setJiraData(null);
              }}
              placeholder="FEAT-12345"
              className="text-input"
              style={{ flex: 1, minWidth: '200px' }}
              required
            />
            <button
              type="button"
              onClick={fetchJiraData}
              disabled={validatingJira || fetchingJira || !jiraKey.trim() || !jiraToken}
              title="Validates the ticket first, then fetches full ticket data: custom fields, dates, epics, and issue breakdown"
              style={{
                padding: '8px 16px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: validatingJira || fetchingJira || !jiraKey.trim() || !jiraToken ? 'not-allowed' : 'pointer',
                opacity: validatingJira || fetchingJira || !jiraKey.trim() || !jiraToken ? 0.6 : 1,
                whiteSpace: 'nowrap'
              }}
            >
              {validatingJira ? 'Validating...' : fetchingJira ? 'Fetching...' : 'Fetch'}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={loading}
              title="Clear all form fields and start over"
              style={{
                padding: '8px 16px',
                backgroundColor: '#f5f5f5',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                whiteSpace: 'nowrap'
              }}
            >
              Clear All
            </button>
          </div>
          {jiraValidationStatus && (
            <div style={{
              marginTop: '8px',
              padding: '12px',
              borderRadius: '4px',
              backgroundColor: jiraValidationStatus.valid ? '#d4edda' : '#f8d7da',
              color: jiraValidationStatus.valid ? '#155724' : '#721c24',
              fontSize: '13px',
              whiteSpace: 'pre-line',
              lineHeight: '1.6'
            }}>
              {jiraValidationStatus.message}
            </div>
          )}
          <small className="help-text">
            Must be a Feature, Initiative, X-FEAT, or Capability issue type
          </small>
          {(!jiraToken || !username) && (
            <small className="help-text" style={{ color: '#dc3545', display: 'block', marginTop: '5px' }}>
              ⚠️ JIRA credentials not configured. Please logout and configure JIRA token in the authentication screen.
            </small>
          )}
        </div>

        {jiraData && (
          <div className="form-group" style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#f8f9fa',
            borderRadius: '4px',
            border: '1px solid #dee2e6'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '16px', fontWeight: 600 }}>Jira ticket details</h3>
            
            {/* Row 1: Key, Summary, Status, Fix Version, Labels - all in one row */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '6%' }}>Key</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '10%' }}>
                    <a 
                      href={`${jiraBaseUrl}/browse/${jiraData.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0065ff', textDecoration: 'none' }}
                    >
                      {jiraData.key}
                    </a>
                  </td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '8%' }}>Summary</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '25%' }}>{jiraData.summary}</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '7%' }}>Status</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '12%' }}>{jiraData.status}</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '9%' }}>Fix Version</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '13%' }}>{jiraData.fixVersions || 'N/A'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '6%' }}>Labels</td>
                  <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '20%', colSpan: '2' }}>{jiraData.labels || 'N/A'}</td>
                  {jiraData.customfield_23560?.name && (
                    <>
                      <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '10%' }}>
                        {jiraData.customfield_23560.name}
                      </td>
                      <td style={{ 
                        padding: '10px', 
                        border: '1px solid #dee2e6', 
                        width: '15%',
                        backgroundColor: jiraData.customfield_23560.color || 'transparent',
                        color: jiraData.customfield_23560.color ? '#ffffff' : 'inherit',
                        fontWeight: 600,
                        textAlign: 'center'
                      }}>
                        {jiraData.customfield_23560.value || 'N/A'}
                      </td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>

            {/* Date fields row: Code Complete Date, FS/DS Done Date, Test Plan Date, Commit Gate Ready Estimation Date, Promotion Gate Ready Estimation Date */}
            {(() => {
              // Helper function to find a field by display name pattern
              const findFieldByName = (namePatterns, excludeFields = []) => {
                const allFields = [
                  jiraData.customfield_11068,
                  jiraData.customfield_11067,
                  jiraData.customfield_35863,
                  jiraData.customfield_35864,
                  jiraData.customfield_23073,
                  jiraData.customfield_45660,
                  jiraData.customfield_23560
                ].filter(f => f && f.name && !excludeFields.includes(f));

                for (const field of allFields) {
                  const fieldNameLower = field.name.toLowerCase();
                  for (const pattern of namePatterns) {
                    if (fieldNameLower.includes(pattern.toLowerCase())) {
                      return field;
                    }
                  }
                }
                return null;
              };

              // Code Complete Date is customfield_11067 - use it directly, don't search for it
              const codeCompleteDate = jiraData.customfield_11067 && 
                jiraData.customfield_11067.name && 
                jiraData.customfield_11067.name.toLowerCase().includes('code complete') 
                ? jiraData.customfield_11067 
                : null;
              
              // FS/DS Done Date is customfield_13861
              const fsDsDoneDateDirect = jiraData.customfield_13861 && 
                jiraData.customfield_13861.name && 
                (jiraData.customfield_13861.name.toLowerCase().includes('fs/ds done') ||
                 jiraData.customfield_13861.name.toLowerCase().includes('fs done') ||
                 jiraData.customfield_13861.name.toLowerCase().includes('ds done'))
                ? jiraData.customfield_13861 
                : null;
              
              // Test Plan Date is customfield_11068
              const testPlanDateDirect = jiraData.customfield_11068 && 
                jiraData.customfield_11068.name && 
                jiraData.customfield_11068.name.toLowerCase().includes('test plan') 
                ? jiraData.customfield_11068 
                : null;
              
              // Exclude date fields from other date searches
              const excludeFromSearch = [codeCompleteDate, fsDsDoneDateDirect, testPlanDateDirect].filter(f => f);
              const fsDsDoneDate = fsDsDoneDateDirect || findFieldByName(['fs/ds done', 'fs done', 'ds done'], excludeFromSearch);
              const testPlanDate = testPlanDateDirect || findFieldByName(['test plan'], excludeFromSearch);
              const commitGateDate = findFieldByName(['commit gate'], excludeFromSearch);
              const promotionGateDate = findFieldByName(['promotion gate'], excludeFromSearch);

              // Only show the row if at least one date field exists
              if (codeCompleteDate || fsDsDoneDate || testPlanDate || commitGateDate || promotionGateDate) {
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '16%' }}>
                          {codeCompleteDate ? codeCompleteDate.name : 'Code Complete Date'}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '16%',
                          backgroundColor: (!codeCompleteDate || !codeCompleteDate.value || codeCompleteDate.value === 'Not Set') ? '#fff3cd' : 'transparent',
                          fontWeight: (!codeCompleteDate || !codeCompleteDate.value || codeCompleteDate.value === 'Not Set') ? 600 : 'normal'
                        }}>
                          {codeCompleteDate && codeCompleteDate.value && codeCompleteDate.value !== 'N/A' && codeCompleteDate.value !== 'NA' ? codeCompleteDate.value : 'Not Set'}
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '16%' }}>
                          {fsDsDoneDate ? fsDsDoneDate.name : 'FS/DS Done Date'}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '16%',
                          backgroundColor: (!fsDsDoneDate || !fsDsDoneDate.value || fsDsDoneDate.value === 'Not Set' || fsDsDoneDate.value === 'N/A' || fsDsDoneDate.value === 'NA') ? '#fff3cd' : 'transparent',
                          fontWeight: (!fsDsDoneDate || !fsDsDoneDate.value || fsDsDoneDate.value === 'Not Set' || fsDsDoneDate.value === 'N/A' || fsDsDoneDate.value === 'NA') ? 600 : 'normal'
                        }}>
                          {fsDsDoneDate && fsDsDoneDate.value && fsDsDoneDate.value !== 'N/A' && fsDsDoneDate.value !== 'NA' ? fsDsDoneDate.value : 'Not Set'}
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '16%' }}>
                          {testPlanDate ? testPlanDate.name : 'Test Plan Date'}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '16%',
                          backgroundColor: (!testPlanDate || !testPlanDate.value || testPlanDate.value === 'Not Set' || testPlanDate.value === 'N/A' || testPlanDate.value === 'NA') ? '#fff3cd' : 'transparent',
                          fontWeight: (!testPlanDate || !testPlanDate.value || testPlanDate.value === 'Not Set' || testPlanDate.value === 'N/A' || testPlanDate.value === 'NA') ? 600 : 'normal'
                        }}>
                          {testPlanDate && testPlanDate.value && testPlanDate.value !== 'N/A' && testPlanDate.value !== 'NA' ? testPlanDate.value : 'Not Set'}
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '16%' }}>
                          {commitGateDate ? commitGateDate.name : 'Commit Gate Ready Estimation Date'}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '16%',
                          backgroundColor: (!commitGateDate || !commitGateDate.value || commitGateDate.value === 'Not Set' || commitGateDate.value === 'N/A' || commitGateDate.value === 'NA') ? '#fff3cd' : 'transparent',
                          fontWeight: (!commitGateDate || !commitGateDate.value || commitGateDate.value === 'Not Set' || commitGateDate.value === 'N/A' || commitGateDate.value === 'NA') ? 600 : 'normal'
                        }}>
                          {commitGateDate && commitGateDate.value && commitGateDate.value !== 'N/A' && commitGateDate.value !== 'NA' ? commitGateDate.value : 'Not Set'}
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '16%' }}>
                          {promotionGateDate ? promotionGateDate.name : 'Promotion Gate Ready Estimation Date'}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '16%',
                          backgroundColor: (!promotionGateDate || !promotionGateDate.value || promotionGateDate.value === 'Not Set' || promotionGateDate.value === 'N/A' || promotionGateDate.value === 'NA') ? '#fff3cd' : 'transparent',
                          fontWeight: (!promotionGateDate || !promotionGateDate.value || promotionGateDate.value === 'Not Set' || promotionGateDate.value === 'N/A' || promotionGateDate.value === 'NA') ? 600 : 'normal'
                        }}>
                          {promotionGateDate && promotionGateDate.value && promotionGateDate.value !== 'N/A' && promotionGateDate.value !== 'NA' ? promotionGateDate.value : 'Not Set'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              }
              return null;
            })()}

            {/* Row for cf[14463], cf[14464], cf[14465], cf[31460] TCMS */}
            {jiraData.customfield_14463?.name || jiraData.customfield_31460?.name || jiraData.customfield_14464?.name || jiraData.customfield_14465?.name ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                <tbody>
                  <tr>
                    {jiraData.customfield_14463?.name && (
                      <>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                          {jiraData.customfield_14463.name}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '12.5%',
                          backgroundColor: jiraData.customfield_14463?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                          fontWeight: jiraData.customfield_14463?.value?.type === 'notSet' ? 600 : 'normal'
                        }}>
                          {jiraData.customfield_14463?.value?.type === 'link' ? (
                            <a 
                              href={jiraData.customfield_14463.value.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#0065ff', textDecoration: 'none' }}
                            >
                              {jiraData.customfield_14463.value.display}
                            </a>
                          ) : (
                            jiraData.customfield_14463?.value?.display || 'Not Set'
                          )}
                        </td>
                      </>
                    )}
                    {jiraData.customfield_14464?.name && (
                      <>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                          {jiraData.customfield_14464.name}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '12.5%',
                          backgroundColor: jiraData.customfield_14464?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                          fontWeight: jiraData.customfield_14464?.value?.type === 'notSet' ? 600 : 'normal'
                        }}>
                          {jiraData.customfield_14464?.value?.type === 'link' ? (
                            <a 
                              href={jiraData.customfield_14464.value.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#0065ff', textDecoration: 'none' }}
                            >
                              {jiraData.customfield_14464.value.display}
                            </a>
                          ) : (
                            jiraData.customfield_14464?.value?.display || 'Not Set'
                          )}
                        </td>
                      </>
                    )}
                    {jiraData.customfield_14465?.name && (
                      <>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                          {jiraData.customfield_14465.name}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '12.5%',
                          backgroundColor: jiraData.customfield_14465?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                          fontWeight: jiraData.customfield_14465?.value?.type === 'notSet' ? 600 : 'normal'
                        }}>
                          {jiraData.customfield_14465?.value?.type === 'link' ? (
                            <a 
                              href={jiraData.customfield_14465.value.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#0065ff', textDecoration: 'none' }}
                            >
                              {jiraData.customfield_14465.value.display}
                            </a>
                          ) : (
                            jiraData.customfield_14465?.value?.display || 'Not Set'
                          )}
                        </td>
                      </>
                    )}
                    {jiraData.customfield_31460?.name && (
                      <>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                          {jiraData.customfield_31460.name}
                        </td>
                        <td style={{ 
                          padding: '8px', 
                          border: '1px solid #dee2e6', 
                          width: '12.5%',
                          backgroundColor: jiraData.customfield_31460?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                          fontWeight: jiraData.customfield_31460?.value?.type === 'notSet' ? 600 : 'normal'
                        }}>
                          {jiraData.customfield_31460?.value?.type === 'link' ? (
                            <a 
                              href={jiraData.customfield_31460.value.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#0065ff', textDecoration: 'none' }}
                            >
                              {jiraData.customfield_31460.value.display}
                            </a>
                          ) : (
                            jiraData.customfield_31460?.value?.display || 'Not Set'
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                </tbody>
              </table>
            ) : null}

            {/* Helper function to check if a field is a date field already displayed */}
            {(() => {
              const isDateField = (field) => {
                if (!field || !field.name) return false;
                const nameLower = field.name.toLowerCase();
                return nameLower.includes('code complete') ||
                       nameLower.includes('fs/ds done') ||
                       nameLower.includes('fs done') ||
                       nameLower.includes('ds done') ||
                       nameLower.includes('test plan') ||
                       nameLower.includes('commit gate') ||
                       nameLower.includes('promotion gate');
              };

              return (
                <>
                  {/* Row for cf[23073] - Only show if it's not a date field */}
                  {jiraData.customfield_23073 && !isDateField(jiraData.customfield_23073) && (
                    <div style={{ marginBottom: '20px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: '#1a1a1a' }}>
                        {jiraData.customfield_23073.name}
                      </h3>
                      <div 
                        style={{ 
                          backgroundColor: '#f8f9fa',
                          padding: '15px',
                          borderLeft: '4px solid #0066cc',
                          borderRadius: '4px',
                          fontSize: '14px',
                          lineHeight: '1.8',
                          color: '#333333'
                        }}
                        dangerouslySetInnerHTML={{ 
                          __html: formatJiraWikiMarkup(jiraData.customfield_23073.value || 'Not Set')
                        }}
                      />
                    </div>
                  )}

                  {/* Row for cf[45660] - Only show if it's not a date field */}
                  {jiraData.customfield_45660 && !isDateField(jiraData.customfield_45660) && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '30%' }}>{jiraData.customfield_45660.name}</td>
                          <td style={{ 
                            padding: '8px', 
                            border: '1px solid #dee2e6',
                            backgroundColor: (!jiraData.customfield_45660.value || jiraData.customfield_45660.value === 'Not Set') ? '#fff3cd' : 'transparent',
                            fontWeight: (!jiraData.customfield_45660.value || jiraData.customfield_45660.value === 'Not Set') ? 600 : 'normal'
                          }}>
                            {jiraData.customfield_45660.value || 'Not Set'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  {/* Note: customfield_23560 (Risk Indicator) is already displayed in Row 1, so we skip it here */}

                  {/* Row for cf[11068] - Only show if it's not a date field */}
                  {jiraData.customfield_11068 && !isDateField(jiraData.customfield_11068) && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '30%' }}>{jiraData.customfield_11068.name}</td>
                          <td style={{ 
                            padding: '8px', 
                            border: '1px solid #dee2e6',
                            backgroundColor: (!jiraData.customfield_11068.value || jiraData.customfield_11068.value === 'Not Set') ? '#fff3cd' : 'transparent',
                            fontWeight: (!jiraData.customfield_11068.value || jiraData.customfield_11068.value === 'Not Set') ? 600 : 'normal'
                          }}>
                            {jiraData.customfield_11068.value || 'Not Set'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </>
              );
            })()}

            {/* JIRA Users Section - Display all people who will be CC'd */}
            {(jiraData.reporter || jiraData.assignee || jiraData.watchers || 
              jiraData.customfield_15968 || jiraData.customfield_10860 || jiraData.customfield_11065 || jiraData.customfield_11861 || jiraData.customfield_11260 || jiraData.customfield_27764 || jiraData.customfield_51460) && (
              <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #dee2e6' }}>
                <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                  JIRA Users (will be included in CC)
                </h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {jiraData.assignee && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                          Assignee
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {jiraData.assignee.displayName || jiraData.assignee.name || jiraData.assignee.emailAddress || jiraData.assignee.email || 'N/A'}
                          {jiraData.assignee.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.assignee.emailAddress})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {jiraData.customfield_15968 && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                          UX Owner
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {typeof jiraData.customfield_15968 === 'string' 
                            ? jiraData.customfield_15968
                            : (jiraData.customfield_15968.displayName || jiraData.customfield_15968.name || jiraData.customfield_15968.emailAddress || jiraData.customfield_15968.email || 'N/A')}
                          {jiraData.customfield_15968 && typeof jiraData.customfield_15968 !== 'string' && jiraData.customfield_15968.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.customfield_15968.emailAddress})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {(jiraData.customfield_10860 || jiraData.customfield_11065) && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                          QA Contact / Test Lead
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {jiraData.customfield_10860 && (
                              <div>
                                <span style={{ fontWeight: 500, color: '#666', fontSize: '12px' }}>QA Contact:</span>{' '}
                                {typeof jiraData.customfield_10860 === 'string' 
                                  ? jiraData.customfield_10860
                                  : (jiraData.customfield_10860.displayName || jiraData.customfield_10860.name || jiraData.customfield_10860.emailAddress || jiraData.customfield_10860.email || 'N/A')}
                                {jiraData.customfield_10860 && typeof jiraData.customfield_10860 !== 'string' && jiraData.customfield_10860.emailAddress && (
                                  <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                    ({jiraData.customfield_10860.emailAddress})
                                  </span>
                                )}
                              </div>
                            )}
                            {jiraData.customfield_11065 && (
                              <div>
                                <span style={{ fontWeight: 500, color: '#666', fontSize: '12px' }}>Test Lead:</span>{' '}
                                {typeof jiraData.customfield_11065 === 'string' 
                                  ? jiraData.customfield_11065
                                  : (jiraData.customfield_11065.displayName || jiraData.customfield_11065.name || jiraData.customfield_11065.emailAddress || jiraData.customfield_11065.email || 'N/A')}
                                {jiraData.customfield_11065 && typeof jiraData.customfield_11065 !== 'string' && jiraData.customfield_11065.emailAddress && (
                                  <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                    ({jiraData.customfield_11065.emailAddress})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {jiraData.customfield_11861 && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                          GUI Lead
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {typeof jiraData.customfield_11861 === 'string' 
                            ? jiraData.customfield_11861
                            : (jiraData.customfield_11861.displayName || jiraData.customfield_11861.name || jiraData.customfield_11861.emailAddress || jiraData.customfield_11861.email || 'N/A')}
                          {jiraData.customfield_11861 && typeof jiraData.customfield_11861 !== 'string' && jiraData.customfield_11861.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.customfield_11861.emailAddress})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {jiraData.customfield_11260 && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                          PM Owner
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {typeof jiraData.customfield_11260 === 'string' 
                            ? jiraData.customfield_11260
                            : (jiraData.customfield_11260.displayName || jiraData.customfield_11260.name || jiraData.customfield_11260.emailAddress || jiraData.customfield_11260.email || 'N/A')}
                          {jiraData.customfield_11260 && typeof jiraData.customfield_11260 !== 'string' && jiraData.customfield_11260.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.customfield_11260.emailAddress})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {jiraData.customfield_27764 && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                          Program Mgr
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {typeof jiraData.customfield_27764 === 'string' 
                            ? jiraData.customfield_27764
                            : (jiraData.customfield_27764.displayName || jiraData.customfield_27764.name || jiraData.customfield_27764.emailAddress || jiraData.customfield_27764.email || 'N/A')}
                          {jiraData.customfield_27764 && typeof jiraData.customfield_27764 !== 'string' && jiraData.customfield_27764.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.customfield_27764.emailAddress})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {jiraData.customfield_51460 && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                          Team Members
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {Array.isArray(jiraData.customfield_51460) ? (
                            <div>
                              {jiraData.customfield_51460.map((member, index) => {
                                const name = typeof member === 'string' 
                                  ? member 
                                  : (member?.displayName || member?.name || member?.emailAddress || member?.email || 'N/A');
                                const email = typeof member === 'object' ? (member?.emailAddress || member?.email) : null;
                                return (
                                  <div key={index} style={{ marginBottom: index < jiraData.customfield_51460.length - 1 ? '4px' : 0 }}>
                                    {name}
                                    {email && (
                                      <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                        ({email})
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : typeof jiraData.customfield_51460 === 'string' ? (
                            jiraData.customfield_51460
                          ) : (
                            <div>
                              {jiraData.customfield_51460.displayName || jiraData.customfield_51460.name || jiraData.customfield_51460.emailAddress || jiraData.customfield_51460.email || 'N/A'}
                              {jiraData.customfield_51460.emailAddress && (
                                <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                  ({jiraData.customfield_51460.emailAddress})
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    {jiraData.reporter && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                          Reporter
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {jiraData.reporter.displayName || jiraData.reporter.name || jiraData.reporter.emailAddress || jiraData.reporter.email || 'N/A'}
                          {jiraData.reporter.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.reporter.emailAddress})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {jiraData.watchers && (
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                          Watchers
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                          {(() => {
                            // Handle different watchers structures
                            let watchersList = [];
                            
                            if (jiraData.watchers.watchers && Array.isArray(jiraData.watchers.watchers)) {
                              // Standard JIRA watchers structure: { watchers: [...] }
                              watchersList = jiraData.watchers.watchers;
                            } else if (Array.isArray(jiraData.watchers)) {
                              // If watchers is directly an array
                              watchersList = jiraData.watchers;
                            } else if (jiraData.watchers) {
                              // If it's a single watcher object
                              watchersList = [jiraData.watchers];
                            }
                            
                            if (watchersList.length === 0) {
                              return <span style={{ color: '#666', fontStyle: 'italic' }}>No watchers</span>;
                            }
                            
                            return watchersList.map((watcher, index) => (
                              <div key={index} style={{ marginBottom: index < watchersList.length - 1 ? '4px' : '0' }}>
                                {typeof watcher === 'string' 
                                  ? watcher
                                  : (watcher.displayName || watcher.name || watcher.emailAddress || watcher.email || 'N/A')}
                                {watcher && typeof watcher !== 'string' && watcher.emailAddress && (
                                  <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                    ({watcher.emailAddress})
                                  </span>
                                )}
                              </div>
                            ));
                          })()}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p style={{ marginTop: '10px', fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
                  These users will be automatically added to the email CC list.
                </p>
              </div>
            )}

          {/* Epics Section */}
          {fetchingEpics && (
            <div className="form-group" style={{ marginTop: '20px', textAlign: 'center' }}>
              <small style={{ color: '#6c757d' }}>Loading epics...</small>
            </div>
          )}

          {epics && epics.length > 0 && (
            <div className="form-group" style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#ffffff',
              border: '1px solid #1a1a1a'
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px', fontWeight: 600, color: '#1a1a1a' }}>
                📋 Epics
              </h3>
              <p style={{ marginBottom: '15px', fontSize: '13px', color: '#666666' }}>
                Total Epics: {epics.reduce((total, feature) => total + (feature.childEpics?.length || 0), 0)}
              </p>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5' }}>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Key</th>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Issue Type</th>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Summary</th>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Status</th>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Resolution</th>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Assignee</th>
                    {epics.length > 0 && epics[0].customfield_10860?.name && (
                      <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>
                        {epics[0].customfield_10860.name}
                      </th>
                    )}
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Due Date</th>
                    <th style={{ padding: '10px', border: '1px solid #1a1a1a', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>Fix Version</th>
                  </tr>
                </thead>
                <tbody>
                  {epics.map((feature, featureIndex) => {
                    const bgColor = featureIndex % 2 === 0 ? '#ffffff' : '#fafafa';
                    return (
                      <React.Fragment key={feature.key}>
                        {/* Feature/Initiative row with single dash */}
                        <tr style={{ backgroundColor: bgColor }}>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>
                            <span style={{ marginRight: '8px' }}>-</span>
                            <a 
                              href={`${jiraBaseUrl}/browse/${feature.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1a1a1a', textDecoration: 'underline' }}
                            >
                              {feature.key}
                            </a>
                          </td>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.issueType || 'Feature'}</td>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.summary}</td>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.status}</td>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.resolution}</td>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.assignee}</td>
                          {epics.length > 0 && epics[0].customfield_10860?.name && (
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>
                              {feature.customfield_10860?.value || 'Not Set'}
                            </td>
                          )}
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.duedate || 'Not Set'}</td>
                          <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{feature.fixVersions}</td>
                        </tr>
                        {/* Child Epics with double dash and indentation */}
                        {feature.childEpics && feature.childEpics.length > 0 && feature.childEpics.map((epic, _epicIndex) => (
                          <tr key={epic.key} style={{ backgroundColor: bgColor }}>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a', paddingLeft: '32px' }}>
                              <span style={{ marginRight: '8px' }}>--</span>
                              <a 
                                href={`${jiraBaseUrl}/browse/${epic.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#1a1a1a', textDecoration: 'underline' }}
                              >
                                {epic.key}
                              </a>
                            </td>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.issueType || 'Epic'}</td>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.summary}</td>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.status}</td>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.resolution}</td>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.assignee}</td>
                            {epics.length > 0 && epics[0].customfield_10860?.name && (
                              <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>
                                {epic.customfield_10860?.value || 'Not Set'}
                              </td>
                            )}
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.duedate || 'Not Set'}</td>
                            <td style={{ padding: '8px', border: '1px solid #1a1a1a', color: '#1a1a1a' }}>{epic.fixVersions}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Issue Breakdown Section */}
          {fetchingBreakdown && (
            <div className="form-group" style={{ marginTop: '20px', textAlign: 'center' }}>
              <small style={{ color: '#6c757d' }}>Loading issue breakdown...</small>
            </div>
          )}

          {issueBreakdown && (
            <div className="form-group" style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#ffffff',
              border: '1px solid #1a1a1a'
            }}>
              {issueBreakdown.total > 0 ? (
                <>
                  <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px', fontWeight: 600, color: '#1a1a1a' }}>
                    📊 Issue Type Breakdown by Status
                  </h3>
                  <p style={{ marginBottom: '15px', fontSize: '13px', color: '#666666' }}>
                    Total Issues: {issueBreakdown.total} (excluding Feature, Epic, Initiative, X-FEAT, Capability)
                  </p>

                  {(() => {
                // Define statusColors at this scope so it's accessible in Overall Statistics
                const statusColors = {
                  'Done': '#28a745',
                  'To Be Verified': '#fd7e14',
                  'In Progress': '#007bff',
                  'To Do': '#6c757d',
                  'Blocked': '#dc3545',
                  'Other': '#cccccc'
                };

                return (
                  <>
                    {issueBreakdown.breakdown.map((item, index) => {
                      const typePercentage = ((item.total / issueBreakdown.total) * 100).toFixed(1);
                      
                      // Calculate percentages for each status category
                      const statusCategories = ['Done', 'To Be Verified', 'In Progress', 'To Do', 'Blocked', 'Other'];
                      const categoryPercentages = statusCategories.map(category => {
                        const categoryData = item.statusCategories[category];
                        const categoryTotal = Object.values(categoryData).reduce((sum, count) => sum + count, 0);
                        return {
                          category,
                          total: categoryTotal,
                          percentage: item.total > 0 ? ((categoryTotal / item.total) * 100) : 0
                        };
                      }).filter(cat => cat.total > 0);
                
                  return (
                    <div key={item.type} style={{ marginBottom: index < issueBreakdown.breakdown.length - 1 ? '20px' : '10px' }}>
                      <div style={{ marginBottom: '8px', fontWeight: 600, fontSize: '14px', color: '#1a1a1a' }}>
                        {item.type}: {item.total} ({typePercentage}%)
                      </div>
                      
                      {/* Stacked bar with all status categories */}
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ 
                          display: 'flex', 
                          height: '24px', 
                          backgroundColor: '#f5f5f5', 
                          borderRadius: '0', 
                          overflow: 'hidden',
                          border: '1px solid #1a1a1a'
                        }}>
                          {categoryPercentages.map((cat, catIndex) => (
                            <div
                              key={cat.category}
                              style={{
                                width: `${cat.percentage}%`,
                                backgroundColor: statusColors[cat.category],
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: cat.category === 'Done' ? '#ffffff' : '#1a1a1a',
                                fontSize: '11px',
                                fontWeight: 600,
                                borderRight: catIndex < categoryPercentages.length - 1 ? '1px solid #1a1a1a' : 'none',
                                minWidth: cat.percentage > 5 ? 'auto' : '0',
                                overflow: 'hidden'
                              }}
                              title={`${cat.category}: ${cat.total} (${cat.percentage.toFixed(1)}%)`}
                            >
                              {cat.percentage > 5 && `${cat.total}`}
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Legend with counts and percentages (colored boxes only, no icons) */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '12px', marginTop: '6px' }}>
                        {categoryPercentages.map(cat => (
                          <div key={cat.category} style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ 
                              display: 'inline-block', 
                              width: '12px', 
                              height: '12px', 
                              backgroundColor: statusColors[cat.category],
                              marginRight: '6px',
                              borderRadius: '0',
                              border: '1px solid #1a1a1a'
                            }}></span>
                            <span style={{ color: '#1a1a1a' }}>{cat.category}: {cat.total} ({cat.percentage.toFixed(1)}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Overall Statistics */}
                {issueBreakdown.overallStats && (
                  <div style={{ 
                    marginTop: '20px', 
                    padding: '15px', 
                    backgroundColor: '#ffffff', 
                    borderRadius: '0', 
                    border: '1px solid #1a1a1a' 
                  }}>
                    <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                      Overall Statistics
                    </h4>
                    <div style={{ fontSize: '13px', color: '#1a1a1a' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ 
                            display: 'inline-block', 
                            width: '12px', 
                            height: '12px', 
                            backgroundColor: statusColors['Done'],
                            marginRight: '6px',
                            borderRadius: '0',
                            border: '1px solid #1a1a1a'
                          }}></span>
                          <span style={{ color: '#1a1a1a' }}>Done: {issueBreakdown.overallStats.done} ({((issueBreakdown.overallStats.done / issueBreakdown.total) * 100).toFixed(1)}%)</span>
                        </div>
                        {issueBreakdown.overallStats.toBeVerified > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ 
                              display: 'inline-block', 
                              width: '12px', 
                              height: '12px', 
                              backgroundColor: statusColors['To Be Verified'],
                              marginRight: '6px',
                              borderRadius: '0',
                              border: '1px solid #1a1a1a'
                            }}></span>
                            <span style={{ color: '#1a1a1a' }}>To Be Verified: {issueBreakdown.overallStats.toBeVerified} ({((issueBreakdown.overallStats.toBeVerified / issueBreakdown.total) * 100).toFixed(1)}%)</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ 
                            display: 'inline-block', 
                            width: '12px', 
                            height: '12px', 
                            backgroundColor: statusColors['In Progress'],
                            marginRight: '6px',
                            borderRadius: '0',
                            border: '1px solid #1a1a1a'
                          }}></span>
                          <span style={{ color: '#1a1a1a' }}>In Progress: {issueBreakdown.overallStats.inProgress} ({((issueBreakdown.overallStats.inProgress / issueBreakdown.total) * 100).toFixed(1)}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ 
                            display: 'inline-block', 
                            width: '12px', 
                            height: '12px', 
                            backgroundColor: statusColors['To Do'],
                            marginRight: '6px',
                            borderRadius: '0',
                            border: '1px solid #1a1a1a'
                          }}></span>
                          <span style={{ color: '#1a1a1a' }}>To Do: {issueBreakdown.overallStats.toDo} ({((issueBreakdown.overallStats.toDo / issueBreakdown.total) * 100).toFixed(1)}%)</span>
                        </div>
                        {issueBreakdown.overallStats.blocked > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ 
                              display: 'inline-block', 
                              width: '12px', 
                              height: '12px', 
                              backgroundColor: statusColors['Blocked'],
                              marginRight: '6px',
                              borderRadius: '0',
                              border: '1px solid #1a1a1a'
                            }}></span>
                            <span style={{ color: '#1a1a1a' }}>Blocked: {issueBreakdown.overallStats.blocked} ({((issueBreakdown.overallStats.blocked / issueBreakdown.total) * 100).toFixed(1)}%)</span>
                          </div>
                        )}
                        {issueBreakdown.overallStats.other > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ 
                              display: 'inline-block', 
                              width: '12px', 
                              height: '12px', 
                              backgroundColor: statusColors['Other'],
                              marginRight: '6px',
                              borderRadius: '0',
                              border: '1px solid #1a1a1a'
                            }}></span>
                            <span style={{ color: '#1a1a1a' }}>Other: {issueBreakdown.overallStats.other} ({((issueBreakdown.overallStats.other / issueBreakdown.total) * 100).toFixed(1)}%)</span>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: '10px', fontWeight: 600, color: '#1a1a1a', fontSize: '14px' }}>
                        Overall Completion Rate: {issueBreakdown.overallStats.completionRate}%
                      </div>
                    </div>
                  </div>
                )}
                  </>
                );
              })()}
                </>
              ) : (
                <p style={{ color: '#666666', fontSize: '13px' }}>
                  No tasks, bugs, or other issues found (excluding Feature, Epic, Initiative, X-FEAT, Capability).
                </p>
              )}
            </div>
          )}

          {/* Sprint Gantt Chart Section */}
          {fetchingSprintGantt && (
            <div className="form-group" style={{ marginTop: '20px', textAlign: 'center' }}>
              <small style={{ color: '#6c757d' }}>Loading sprint timeline...</small>
            </div>
          )}

          {sprintGanttData && sprintGanttData.sprintTickets && sprintGanttData.sprintTickets.length > 0 && (
            <div className="form-group" style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#ffffff',
              border: '1px solid #1a1a1a'
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px', fontWeight: 600, color: '#1a1a1a' }}>
                📅 Sprint Timeline - Project Tickets
              </h3>
              <p style={{ marginBottom: '15px', fontSize: '13px', color: '#666666' }}>
                Total Sprint Tickets: {sprintGanttData.sprintTickets.length} | 
                In Sprint: {sprintGanttData.sprintTickets.filter(t => t.sprintEndDate).length} | 
                Unassigned: {sprintGanttData.sprintTickets.filter(t => !t.sprintEndDate).length}
              </p>

              {/* Timeline Controls */}
              <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>
                  View: 
                  <select 
                    style={{ 
                      marginLeft: '5px', 
                      padding: '4px 8px', 
                      border: '1px solid #dee2e6', 
                      borderRadius: '4px',
                      fontSize: '13px'
                    }}
                    defaultValue="monthly"
                    onChange={(_e) => {
                      // Update view mode - we'll implement this with state if needed
                    }}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </label>
              </div>

              {/* Gantt Chart */}
              <div style={{ overflowX: 'auto', border: '1px solid #dee2e6', borderRadius: '4px' }}>
                <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse', backgroundColor: '#ffffff' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa' }}>
                      <th style={{ 
                        border: '1px solid #dee2e6', 
                        padding: '10px', 
                        textAlign: 'left', 
                        fontWeight: 600, 
                        fontSize: '13px',
                        minWidth: '200px',
                        position: 'sticky',
                        left: 0,
                        backgroundColor: '#f8f9fa',
                        zIndex: 1
                      }}>
                        Ticket
                      </th>
                      {sprintGanttData.timelineColumns && sprintGanttData.timelineColumns.map((col, index) => (
                        <th key={index} style={{ 
                          border: '1px solid #dee2e6', 
                          padding: '8px', 
                          textAlign: 'center', 
                          fontWeight: 600, 
                          fontSize: '11px',
                          minWidth: '80px',
                          backgroundColor: col.isToday ? '#fef2f2' : '#f8f9fa',
                          color: col.isToday ? '#dc2626' : '#1a1a1a'
                        }}>
                          {col.label}
                          {col.isToday && <div style={{ fontSize: '9px', color: '#dc2626' }}>TODAY</div>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sprintGanttData.sprintTickets.map((ticket, ticketIndex) => (
                      <tr key={ticket.key} style={{ 
                        backgroundColor: ticketIndex % 2 === 0 ? '#ffffff' : '#fafafa',
                        ':hover': { backgroundColor: '#f0f9ff' }
                      }}>
                        <td style={{ 
                          border: '1px solid #dee2e6', 
                          padding: '8px',
                          position: 'sticky',
                          left: 0,
                          backgroundColor: ticketIndex % 2 === 0 ? '#ffffff' : '#fafafa',
                          zIndex: 1
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ 
                              fontFamily: 'monospace', 
                              fontWeight: 500, 
                              color: '#0066cc', 
                              fontSize: '12px' 
                            }}>
                              {ticket.key}
                            </div>
                            <div style={{ 
                              fontSize: '11px', 
                              color: '#666666',
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }} title={ticket.summary}>
                              {ticket.summary}
                            </div>
                            {ticket.sprintName && (
                              <div style={{ 
                                fontSize: '10px', 
                                color: '#059669',
                                fontWeight: 500
                              }}>
                                {ticket.sprintName}
                              </div>
                            )}
                          </div>
                        </td>
                        {sprintGanttData.timelineColumns && sprintGanttData.timelineColumns.map((col, colIndex) => {
                          const isInSprint = ticket.sprintStartDate && ticket.sprintEndDate &&
                            new Date(ticket.sprintStartDate) <= new Date(col.endDate) &&
                            new Date(ticket.sprintEndDate) >= new Date(col.startDate);
                          
                          const showTodayMarker = col.isToday;
                          
                          return (
                            <td key={colIndex} style={{ 
                              border: '1px solid #dee2e6', 
                              padding: '4px',
                              textAlign: 'center',
                              verticalAlign: 'middle',
                              position: 'relative',
                              backgroundColor: showTodayMarker ? '#fef2f2' : 'transparent'
                            }}>
                              {isInSprint ? (
                                <div style={{
                                  height: '20px',
                                  backgroundColor: '#059669',
                                  borderRadius: '10px',
                                  margin: '0 2px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '9px',
                                  color: 'white',
                                  fontWeight: 500,
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                }} title={`Sprint: ${ticket.sprintName}\n${ticket.sprintStartDate} - ${ticket.sprintEndDate}`}>
                                  SPRINT
                                </div>
                              ) : ticket.sprintEndDate ? null : (
                                showTodayMarker && (
                                  <div style={{
                                    width: '12px',
                                    height: '12px',
                                    backgroundColor: '#94a3b8',
                                    borderRadius: '50%',
                                    margin: '4px auto',
                                    opacity: 0.7
                                  }} title="No sprint assigned" />
                                )
                              )}
                              {showTodayMarker && (
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: '50%',
                                  width: '2px',
                                  backgroundColor: '#dc2626',
                                  transform: 'translateX(-50%)',
                                  zIndex: 2
                                }} />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div style={{ marginTop: '15px', display: 'flex', gap: '20px', fontSize: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '20px', height: '12px', backgroundColor: '#059669', borderRadius: '6px' }}></div>
                  <span>Sprint Timeline</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '12px', height: '12px', backgroundColor: '#94a3b8', borderRadius: '50%', opacity: 0.7 }}></div>
                  <span>No Sprint Assigned</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '2px', height: '12px', backgroundColor: '#dc2626' }}></div>
                  <span>Today</span>
                </div>
              </div>

              {/* Sprint Statistics */}
              {sprintGanttData.sprintStats && (
                <div style={{ 
                  marginTop: '15px', 
                  padding: '12px', 
                  backgroundColor: '#f8f9fa', 
                  borderRadius: '4px',
                  border: '1px solid #e9ecef'
                }}>
                  <h4 style={{ marginTop: 0, marginBottom: '8px', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                    Sprint Statistics
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', fontSize: '13px' }}>
                    <div>
                      <strong>Sprint Coverage:</strong> {sprintGanttData.sprintStats.sprintCoverage}%
                    </div>
                    <div>
                      <strong>Active Sprints:</strong> {sprintGanttData.sprintStats.activeSprints}
                    </div>
                    <div>
                      <strong>Avg Sprint Length:</strong> {sprintGanttData.sprintStats.avgSprintLength} days
                    </div>
                    <div>
                      <strong>Next Sprint End:</strong> {sprintGanttData.sprintStats.nextSprintEnd || 'N/A'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {jiraData && (
          <div className="form-group">
            <label id="email-subject-label">Email Subject Line</label>
            <div
              id="email-subject"
              role="textbox"
              aria-labelledby="email-subject-label"
              aria-readonly="true"
              style={{
                padding: '10px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#495057',
                minHeight: '20px'
              }}
            >
              {emailSubject || 'Subject will be auto-populated after fetching JIRA data'}
            </div>
            <small className="help-text">
              Subject line is automatically populated from JIRA ticket data
            </small>
          </div>
        )}

        {jiraData && (
          <>
            <div className="form-group">
              <label id="highlights-lowlights-label">Highlights and Lowlights *</label>
              <div id="highlights-lowlights" role="textbox" aria-labelledby="highlights-lowlights-label" aria-multiline="true">
                <ReactQuill
                  ref={quillRef}
                  value={additionalDetails}
                  onChange={setAdditionalDetails}
                  modules={quillModules}
                  placeholder="Highlights and lowlights, reason for risk (if yellow/red), path to green, support needed from leaders..."
                  className="rich-text-editor"
                />
              </div>
              {!isHighlightsLowlightsEmpty(additionalDetails) && (() => {
                const { missingSections } = validateHighlightsLowlightsSections(additionalDetails);
                if (missingSections.length === 0) return null;
                const handleAddMissingSections = () => {
                  const appended = missingSections.map(s =>
                    `<h2>${s}:</h2><p><br></p><p><br></p>`
                  ).join('');
                  setAdditionalDetails(prev => prev + appended);
                };
                return (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#c53030' }}>
                      <strong>Missing sections:</strong> {missingSections.join('; ')}
                    </span>
                    <button
                      type="button"
                      onClick={handleAddMissingSections}
                      style={{
                        fontSize: '0.8125rem',
                        padding: '2px 10px',
                        cursor: 'pointer',
                        border: '1px solid #c53030',
                        borderRadius: '4px',
                        background: '#fff',
                        color: '#c53030',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      + Add missing sections
                    </button>
                  </div>
                );
              })()}
            </div>

            <div className="form-group">
              <label htmlFor="email-recipients">Additional Recipients</label>
              <input
                type="text"
                id="email-recipients"
                value={emailRecipients}
                onChange={(e) => {
                  const value = e.target.value;
                  setEmailRecipients(value);
                  validateEmailRecipients(value);
                }}
                onBlur={(e) => {
                  // Normalize on blur (convert usernames to emails)
                  if (validateEmailRecipients(e.target.value)) {
                    const normalized = normalizeEmailRecipients(e.target.value);
                    if (normalized !== e.target.value) {
                      setEmailRecipients(normalized);
                    }
                  }
                }}
                placeholder="user@nutanix.com; username (optional)"
                className="text-input"
                style={{
                  borderColor: emailRecipientsError ? '#c53030' : '#1a1a1a'
                }}
              />
              {emailRecipientsError && (
                <div style={{ 
                  color: '#c53030', 
                  fontSize: '0.8125rem', 
                  marginTop: '0.5rem' 
                }}>
                  {emailRecipientsError}
                </div>
              )}
              <small className="help-text">
                Enter Nutanix email addresses (user@nutanix.com) or usernames (user.name). Separate multiple with semicolons (;). Optional - if not provided, email will only be sent to CC recipients.
              </small>
            </div>


          </>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        {/* Only show Send Email button after Fetch is complete */}
        {jiraData && (
          <div className="button-group" style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '20px', flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1
            }}>
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
                disabled={loading}
                style={{ width: '18px', height: '18px', cursor: loading ? 'not-allowed' : 'pointer' }}
              />
              <span>Attach PDF</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1
            }}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={loading}
                style={{ width: '18px', height: '18px', cursor: loading ? 'not-allowed' : 'pointer' }}
              />
              <span>Dry run (don&apos;t send)</span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1
            }}>
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                disabled={loading}
                style={{ width: '18px', height: '18px', cursor: loading ? 'not-allowed' : 'pointer' }}
              />
              <span>Test mode (send only to me)</span>
            </label>
            {(() => {
              const missing = validateHighlightsLowlightsSections(additionalDetails).missingSections;
              const disabledReason = !jiraKey.trim()
                ? 'JIRA key is required'
                : isHighlightsLowlightsEmpty(additionalDetails)
                  ? 'Highlights and Lowlights is required'
                  : missing.length > 0
                    ? `Missing sections: ${missing.join('; ')}`
                    : '';
              return (
                <>
                  <button
                    onClick={handleSend}
                    className="btn-send"
                    disabled={loading || !!disabledReason}
                    title={disabledReason || undefined}
                  >
                    {loading ? 'Sending...' : 'Send Email'}
                  </button>
                  <span className="copy-email-wrap" aria-label="Copy email actions">
                    <OutlookFallback
                      buttonLabel="Copy Email to Clipboard"
                      getPreview={async () => {
                        const res = await authenticatedPost('/api/email/preview', {
                          additionalDetails,
                          emailRecipients: emailRecipients && emailRecipients.trim() ? normalizeEmailRecipients(emailRecipients) : '',
                          emailSubject: emailSubject || undefined,
                          jiraKey: jiraKey.trim(),
                          jiraData: jiraData || undefined,
                          epics: epics || undefined,
                          issueBreakdown: issueBreakdown || undefined
                        }, { jiraToken, username });
                        return res.data;
                      }}
                    />
                  </span>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

export default EmailSender;

