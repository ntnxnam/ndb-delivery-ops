import { useState, useRef, useEffect } from 'react';
import { authenticatedPost } from '../../shared/services/apiService';
import { useJiraConfig } from '../../utils/jiraConfig';
import { useTeam } from '../../contexts/TeamContext';
import { useEmailSenderCCConfig } from '../../hooks/useEmailSenderCCConfig';
import { HIGHLIGHTS_LOWLIGHTS_TEMPLATE } from '../../config/emailSenderFeatures';
import {
  isHighlightsLowlightsEmpty,
  validateHighlightsLowlightsSections,
  formatJiraWikiMarkup as formatJiraWikiMarkupHelper,
} from './emailSenderHelpers';
import { createEmailSenderJiraActions } from './emailSenderJiraActions';

export function useEmailSender() {
const [additionalDetails, setAdditionalDetails] = useState('');
const [aiSummaryDraft, setAiSummaryDraft] = useState('');
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
const [workItems, setWorkItems] = useState(null);
const [payloadJql, setPayloadJql] = useState('');
/** Spec D/F extras from Feature Dashboard API (KPI boxes; optional later). */
const [featureDashExtras, setFeatureDashExtras] = useState(null);
const [sprintGanttData, setSprintGanttData] = useState(null);
const [fetchingSprintGantt, setFetchingSprintGantt] = useState(false);
/** Pulled ticket data panel — expanded by default; user can still collapse. */
const [pulledTicketDataOpen, setPulledTicketDataOpen] = useState(true);
const [loading, setLoading] = useState(false);
const [error, setError] = useState('');
const [success, setSuccess] = useState('');
const [attachPdf, setAttachPdf] = useState(false);
const [testMode, setTestMode] = useState(false);
const [dryRun, setDryRun] = useState(false);
const [optionalCCChecked, setOptionalCCChecked] = useState({});
const quillRef = useRef(null);

// JIRA configuration
const { jiraBaseUrl } = useJiraConfig();
  const formatJiraWikiMarkup = (text) => formatJiraWikiMarkupHelper(text, jiraBaseUrl);
const { selectedTeamId } = useTeam();
const { config: emailSenderCCConfig } = useEmailSenderCCConfig();
const optionalCCList = Array.isArray(emailSenderCCConfig?.defaultCC)
  ? emailSenderCCConfig.defaultCC
  : [];

// Optional leadership CC checkboxes start unchecked
useEffect(() => {
  if (!optionalCCList.length) return;
  const initial = {};
  optionalCCList.forEach((_, i) => { initial[String(i)] = false; });
  setOptionalCCChecked(initial);
}, [optionalCCList.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when config list changes

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

// Clear all JIRA-related data when jiraKey changes
useEffect(() => {
  if (!jiraKey.trim()) {
    // If jiraKey is cleared, clear all related state
    setJiraData(null);
    setEpics(null);
    setIssueBreakdown(null);
    setWorkItems(null);
    setFeatureDashExtras(null);
    setPayloadJql('');
    setSprintGanttData(null);
    setJiraValidationStatus(null);
    setEmailSubject('');
  }
}, [jiraKey]);


  const { validateJiraKey, fetchJiraData, fetchEpics, fetchSprintGanttData } = createEmailSenderJiraActions({
    jiraKey, jiraToken, username, selectedTeamId,
    jiraData, jiraValidationStatus, epics,
    setValidatingJira, setJiraValidationStatus, setError, setSuccess,
    setFetchingJira, setJiraData, setEpics, setIssueBreakdown, setWorkItems,
    setFeatureDashExtras, setPayloadJql, setSprintGanttData, setPulledTicketDataOpen,
    setFetchingEpics, setFetchingBreakdown, setFetchingSprintGantt, setEmailSubject,
  });

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    ['link'],
    ['clean']
  ]
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
    if (!String(aiSummaryDraft || '').trim()) {
      setError('Generate AI risk summary before sending (required in the email body).');
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

    const selectedCCRecipients = optionalCCList.filter((_, i) => optionalCCChecked[String(i)]);

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await authenticatedPost('/api/email/send', {
        executiveSummary: '', // Deprecated: narrative is in additionalDetails (Highlights and Lowlights)
        additionalDetails,
        aiSummary: aiSummaryDraft.trim(),
        emailRecipients: normalizedRecipients,
        emailSubject: emailSubject || undefined,
        jiraKey: jiraKey.trim(),
        jiraData: jiraData || undefined,
        epics: epics || undefined,
        workItems: workItems || undefined,
        issueBreakdown: issueBreakdown || undefined,
        sprintGanttData: sprintGanttData || undefined,
        attachPdf: attachPdf,
        isTest: testMode,
        dryRun: dryRun,
        selectedCCRecipients
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
    setAiSummaryDraft('');
    setEmailRecipients('');
    setEmailSubject('');
    setJiraKey('');
    setJiraValidationStatus(null);
    setJiraData(null);
    setEpics(null);
    setIssueBreakdown(null);
    setWorkItems(null);
    setFeatureDashExtras(null);
    setPayloadJql('');
    setSprintGanttData(null);
    setError('');
    setSuccess('');
    const resetCC = {};
    optionalCCList.forEach((_, i) => { resetCC[String(i)] = false; });
    setOptionalCCChecked(resetCC);
  };


  const previewEmail = async () => {
    const selectedCCRecipients = optionalCCList.filter((_, i) => optionalCCChecked[String(i)]);
    const normalizedRecipients = emailRecipients && emailRecipients.trim()
      ? normalizeEmailRecipients(emailRecipients)
      : '';
    const res = await authenticatedPost('/api/email/preview', {
      executiveSummary: '',
      additionalDetails,
      aiSummary: (aiSummaryDraft || '').trim(),
      emailRecipients: normalizedRecipients,
      emailSubject: emailSubject || undefined,
      jiraKey: jiraKey.trim(),
      jiraData: jiraData || undefined,
      epics: epics || undefined,
      workItems: workItems || undefined,
      issueBreakdown: issueBreakdown || undefined,
      sprintGanttData: sprintGanttData || undefined,
      selectedCCRecipients,
    }, { jiraToken, username });
    return res.data;
  };

  return {
    // config
    jiraBaseUrl,
    optionalCCList,
    username,
    jiraToken,
    quillRef,
    quillModules,
    // state
    additionalDetails, setAdditionalDetails,
    aiSummaryDraft, setAiSummaryDraft,
    emailRecipients, setEmailRecipients,
    emailRecipientsError, setEmailRecipientsError,
    emailSubject, setEmailSubject,
    jiraKey, setJiraKey,
    validatingJira,
    jiraValidationStatus, setJiraValidationStatus,
    fetchingJira,
    jiraData, setJiraData,
    fetchingEpics,
    epics,
    fetchingBreakdown,
    issueBreakdown,
    workItems,
    payloadJql,
    featureDashExtras,
    sprintGanttData,
    fetchingSprintGantt,
    pulledTicketDataOpen, setPulledTicketDataOpen,
    loading,
    error, setError,
    success,
    attachPdf, setAttachPdf,
    testMode, setTestMode,
    dryRun, setDryRun,
    optionalCCChecked, setOptionalCCChecked,
    // actions
    validateEmailRecipients,
    normalizeEmailRecipients,
    formatJiraWikiMarkup,
    validateJiraKey,
    fetchJiraData,
    fetchEpics,
    handleSend,
    handleClearAll,
    fetchSprintGanttData,
    previewEmail,
  };
}
