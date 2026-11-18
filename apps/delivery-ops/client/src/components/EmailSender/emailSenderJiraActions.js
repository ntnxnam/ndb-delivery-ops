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
      
      // Pass fresh data directly — do not rely on closure over jiraData which is still null this render
      if (jiraToken) {
        fetchEpics({ jiraKey: jiraKey.trim(), jiraData: response.data.data });
        fetchSprintGanttData({ jiraKey: jiraKey.trim(), jiraData: response.data.data });
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

const fetchEpics = async (opts = {}) => {
  const freshKey = (opts.jiraKey || jiraKey || '').trim();
  const freshJiraData = opts.jiraData !== undefined ? opts.jiraData : jiraData;
  if (!freshKey || !jiraToken) {
    return;
  }

  setFetchingEpics(true);
  setEpics(null);

  const rawFixVersions = freshJiraData?.fixVersions;
  const releaseParts = Array.isArray(rawFixVersions)
    ? rawFixVersions.map((s) => String(s).trim())
    : String(rawFixVersions || '').split(',').map((s) => s.trim());
  const releaseHint = releaseParts.find((s) => s && s !== 'N/A');

  // Canonical-first: try Feature Dashboard payload when release is known; fall back to legacy otherwise.
  const tryLegacyFetch = async () => {
    try {
      const response = await authenticatedPost('/api/jira/fetch-all-jira-tickets', {
        jiraKey: freshKey,
        jiraData: freshJiraData || undefined
      }, { jiraToken, username });
      if (response.data.success) {
        setEpics(response.data.epics);
        setIssueBreakdown(response.data.issueBreakdown || null);
        setWorkItems(Array.isArray(response.data.workItems) ? response.data.workItems : null);
        setPayloadJql(response.data.payloadJql || '');
        setFetchingBreakdown(false);
        return true;
      }
      console.warn('Failed to fetch epics:', response.data.error);
      setWorkItems([]);
      setFetchingBreakdown(false);
      return false;
    } catch (err) {
      console.warn('Error fetching epics:', err.message);
      setWorkItems([]);
      setFetchingBreakdown(false);
      return false;
    }
  };

  if (releaseHint && freshKey) {
    try {
      const data = await fetchFeatureDashboard({
        release: releaseHint,
        featureKey: freshKey,
        teamId: selectedTeamId || 'ndb',
        jiraToken,
        username,
      });
      setFeatureDashExtras({
        teamKpiBoxes: data.teamKpiBoxes || [],
        inference: data.inference || null,
        kickoff: data.kickoff || null,
        timing: data.timing || null,
      });
      const fdEpics = buildEpicsFromFeatureDashboard(
        data?.payload?.canonical,
        freshKey,
        { rootIssueType: freshJiraData?.issueType }
      );
      if (fdEpics && fdEpics.length > 0) {
        setEpics(fdEpics);
        // Derive IssueTypeBreakdown from canonical so the breakdown widget isn't blank on the happy path (review #3.4.1)
        try {
          const canonical = Array.isArray(data?.payload?.canonical) ? data.payload.canonical : [];
          setIssueBreakdown(canonical.length ? buildIssueBreakdownFromCanonical(canonical) : null);
        } catch {
          setIssueBreakdown(null);
        }
        setWorkItems(Array.isArray(data?.payload?.canonical) ? data.payload.canonical : null);
        setPayloadJql(data?.jql?.canonical || '');
        setFetchingBreakdown(false);
        return;
      }
      // Canonical returned no usable epics — fall back to legacy
      await tryLegacyFetch();
    } catch {
      setFeatureDashExtras(null);
      await tryLegacyFetch();
    } finally {
      setFetchingEpics(false);
    }
    return;
  }

  // No release hint — legacy path only
  try {
    await tryLegacyFetch();
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

const fetchSprintGanttData = async (opts = {}) => {
  const freshKey = (opts.jiraKey || jiraKey || '').trim();
  const freshJiraData = opts.jiraData !== undefined ? opts.jiraData : jiraData;
  const freshEpics = opts.epics !== undefined ? opts.epics : epics;
  if (!freshKey || !jiraToken) {
    return;
  }

  setFetchingSprintGantt(true);
  setSprintGanttData(null);

  try {
    const response = await authenticatedPost('/api/jira/sprint-gantt-data', {
      jiraKey: freshKey,
      jiraData: freshJiraData || undefined,
      epics: freshEpics || undefined
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

// Client-side breakdown builder for canonical path — mirrors taskBreakdownService.processTicketsClientSide
// but operates on Feature Dashboard canonical issues (issueType/status already normalized).
function buildIssueBreakdownFromCanonical(canonical) {
  const categorizeStatus = (status) => {
    switch (status) {
      case 'Done':
      case 'Closed': return 'Done';
      case 'Resolved': return 'To Be Verified';
      case 'In Progress':
      case 'Development': case 'Code Review': case 'In Review':
      case 'Testing': case 'QA': case 'UAT': case 'Pending Merge': return 'In Progress';
      case 'To Do': case 'Open': case 'Backlog': case 'New':
      case 'Ready': case 'Ready for Development': case 'Selected for Development': return 'To Do';
      case 'Blocked': case 'On Hold': case 'Need Info': case 'Needs Info':
      case 'Waiting': case 'Waiting for Information': case 'Pending': return 'Blocked';
      default: return 'Other';
    }
  };
  const doneTickets = canonical.filter((t) => t.status === 'Done' || t.status === 'Closed');
  const outstanding = canonical.filter((t) => t.status !== 'Done' && t.status !== 'Closed');
  const breakdown = {};
  for (const t of outstanding) {
    const type = t.issueType || 'Unknown';
    const s = t.status || 'Unknown';
    if (!breakdown[type]) breakdown[type] = { total: 0, statuses: {} };
    breakdown[type].total++;
    breakdown[type].statuses[s] = (breakdown[type].statuses[s] || 0) + 1;
  }
  const formattedBreakdown = Object.entries(breakdown).map(([type, data]) => {
    const statusCategories = { Done: {}, 'To Be Verified': {}, 'In Progress': {}, 'To Do': {}, Blocked: {}, Other: {} };
    for (const [s, n] of Object.entries(data.statuses)) statusCategories[categorizeStatus(s)][s] = n;
    return { type, total: data.total, statusCategories };
  }).sort((a, b) => b.total - a.total);
  let totalDone = doneTickets.length; let totalToBeVerified = 0; let totalInProgress = 0; let totalToDo = 0; let totalBlocked = 0; let totalOther = 0;
  for (const { statusCategories } of formattedBreakdown) {
    for (const n of Object.values(statusCategories['To Be Verified'])) totalToBeVerified += n;
    for (const n of Object.values(statusCategories['In Progress'])) totalInProgress += n;
    for (const n of Object.values(statusCategories['To Do'])) totalToDo += n;
    for (const n of Object.values(statusCategories.Blocked)) totalBlocked += n;
    for (const n of Object.values(statusCategories.Other)) totalOther += n;
  }
  const total = canonical.length;
  return {
    total,
    breakdown: formattedBreakdown,
    overallStats: {
      done: totalDone, toBeVerified: totalToBeVerified, inProgress: totalInProgress,
      toDo: totalToDo, blocked: totalBlocked, other: totalOther,
      completionRate: total > 0 ? (((totalDone + totalToBeVerified) / total) * 100).toFixed(1) : '0.0',
    },
    outstandingCount: outstanding.length,
  };
}
