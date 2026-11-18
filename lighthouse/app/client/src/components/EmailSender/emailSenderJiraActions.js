import { authenticatedPost } from '../../shared/services/apiService';
import { fetchFeatureDashboard } from '../../feature/services/featureDashboardService';
import { buildEpicsFromFeatureDashboard } from './buildEpicsFromFeatureDashboard';
import { buildWeeklyUpdateSubject } from './emailSenderHelpers';

/**
 * JIRA validate/fetch/epics/gantt actions for Email Sender.
 */
export function createEmailSenderJiraActions(ctx) {
  const {
    jiraKey, jiraToken, username, selectedTeamId,
    jiraData, jiraValidationStatus, epics,
    setValidatingJira, setJiraValidationStatus, setError, setSuccess,
    setFetchingJira, setJiraData, setEpics, setIssueBreakdown, setWorkItems,
    setFeatureDashExtras, setPayloadJql, setSprintGanttData, setPulledTicketDataOpen,
    setFetchingEpics, setFetchingBreakdown, setFetchingSprintGantt, setEmailSubject,
  } = ctx;

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
    
    // Auto-populate email subject: type, summary, release, weekly update, date
    if (response.data.issueType && response.data.summary) {
      setEmailSubject(buildWeeklyUpdateSubject(response.data));
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
  setWorkItems(null);
  setFeatureDashExtras(null);
  setPayloadJql('');
  setSprintGanttData(null);
  setPulledTicketDataOpen(true);

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
      
      // Auto-populate email subject from fetched ticket, including fix version
      if (response.data.data.issueType && response.data.data.summary) {
        setEmailSubject(buildWeeklyUpdateSubject(response.data.data));
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
      setIssueBreakdown(response.data.issueBreakdown || null);
      setWorkItems(Array.isArray(response.data.workItems) ? response.data.workItems : null);
      setPayloadJql(response.data.payloadJql || '');
      setFetchingBreakdown(false);

      // Feature Dashboard: epic set + KPI extras (same canonical payload as Feature Dashboard page).
      const releaseHint = (jiraData?.fixVersions || '')
        .split(',')
        .map((s) => s.trim())
        .find((s) => s && s !== 'N/A');
      if (releaseHint && jiraKey.trim()) {
        fetchFeatureDashboard({
          release: releaseHint,
          featureKey: jiraKey.trim(),
          teamId: selectedTeamId || 'ndb',
          jiraToken,
          username,
        })
          .then((data) => {
            setFeatureDashExtras({
              teamKpiBoxes: data.teamKpiBoxes || [],
              inference: data.inference || null,
              kickoff: data.kickoff || null,
              timing: data.timing || null,
            });
            const fdEpics = buildEpicsFromFeatureDashboard(
              data?.payload?.canonical,
              jiraKey.trim(),
              { rootIssueType: jiraData?.issueType }
            );
            if (fdEpics && fdEpics.length > 0) {
              setEpics(fdEpics);
            }
          })
          .catch(() => setFeatureDashExtras(null));
      }
    } else {
      console.warn('Failed to fetch epics:', response.data.error);
      setWorkItems([]);
      setFetchingBreakdown(false);
    }
  } catch (err) {
    console.warn('Error fetching epics:', err.message);
    setWorkItems([]);
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


  return { validateJiraKey, fetchJiraData, fetchEpics, fetchSprintGanttData };
}
