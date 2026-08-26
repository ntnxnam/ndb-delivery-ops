const { JIRA_API_V2 } = require('../config/api');
const logger = require('../utils/logger');
const { getJira } = require('../utils/jiraClient');
const releaseItemsService = require('./releaseItemsDataService');
const { buildCommitItemsJQL, buildLongTermItemsJQL } = require('../utils/jiraQueryUtils');
const teamBoardConfig = require('../config/teamBoardConfig.json');
const { getFieldId } = require('../utils/jiraFieldsConfig');
const { formatDate } = require('../utils/dateFormatter');

async function getReleaseCommitItems(fixVersion, jiraToken) {
  const requestId = `exec-commit-${Date.now()}`;
  const cleanToken = jiraToken?.replace(/^Bearer\s+/i, '') || jiraToken;
  try {
    const teams = teamBoardConfig.teams || [];
    const team = teams.find((t) => t.id === teamBoardConfig.defaultTeamId) || teams[0];
    const jql = buildCommitItemsJQL(fixVersion, team);
    const allIssues = await releaseItemsService._internals.fetchReleaseItemsFromJira(jql, cleanToken, null, requestId);
    const items = await releaseItemsService._internals.processReleaseItems(allIssues, cleanToken, null, requestId, team?.boardId);
    return { items, success: true };
  } catch (error) {
    return { items: [], success: false, error: error.message };
  }
}

async function getReleaseLongTermItems(fixVersion, jiraToken) {
  const requestId = `exec-longterm-${Date.now()}`;
  const cleanToken = jiraToken?.replace(/^Bearer\s+/i, '') || jiraToken;
  try {
    const teams = teamBoardConfig.teams || [];
    const team = teams.find((t) => t.id === teamBoardConfig.defaultTeamId) || teams[0];
    const jql = buildLongTermItemsJQL(fixVersion, team);
    const allIssues = await releaseItemsService._internals.fetchReleaseItemsFromJira(jql, cleanToken, null, requestId);
    const items = await releaseItemsService._internals.processReleaseItems(allIssues, cleanToken, null, requestId, team?.boardId);
    return { items, success: true };
  } catch (error) {
    return { items: [], success: false, error: error.message };
  }
}

async function fetchExecSummaryIssues(jiraToken, jqlQuery) {
  const cleanToken = jiraToken?.replace(/^Bearer\s+/i, '') || jiraToken;
  const fields = [
    'key', 'summary', 'status', 'priority', 'assignee', 'issuetype',
    'fixVersions', 'labels', 'duedate', 'created', 'updated', 'resolution',
    getFieldId('codeComplete'), getFieldId('commitGate'), getFieldId('promotionGate'),
    getFieldId('riskIndicator'), teamBoardConfig.sprintFieldId, getFieldId('tpmOwner')
  ].filter(Boolean).join(',');
  const jira = await getJira(cleanToken);
  const response = await jira.get(JIRA_API_V2.SEARCH, {
    timeout: 30000,
    params: { jql: jqlQuery, fields, maxResults: 1000 }
  });
  return response.data.issues || [];
}

function generateTimelineColumns() {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);
  const timelineColumns = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    timelineColumns.push({
      label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      startDate: monthStart.toISOString().split('T')[0],
      endDate: monthEnd.toISOString().split('T')[0],
      isToday: today >= monthStart && today <= monthEnd
    });
    current.setMonth(current.getMonth() + 1);
  }
  return timelineColumns;
}

function calculateSprintStats(enrichedTickets, sprintCache) {
  const today = new Date();
  const sprintStats = {
    sprintCoverage: enrichedTickets.length > 0 ? Math.round((enrichedTickets.filter((t) => t.sprintEndDate).length / enrichedTickets.length) * 100) : 0,
    activeSprints: new Set(enrichedTickets.filter((t) => t.sprintState === 'active').map((t) => t.sprintId)).size,
    avgSprintLength: 0,
    nextSprintEnd: null
  };
  const sprintLengths = [];
  let nextSprintEndDate = null;
  sprintCache.forEach((sprint) => {
    if (sprint.startDate && sprint.endDate) {
      const start = new Date(sprint.startDate);
      const end = new Date(sprint.endDate);
      sprintLengths.push(Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
      if (end > today && (!nextSprintEndDate || end < nextSprintEndDate)) nextSprintEndDate = end;
    }
  });
  if (sprintLengths.length > 0) sprintStats.avgSprintLength = Math.round(sprintLengths.reduce((a, b) => a + b, 0) / sprintLengths.length);
  if (nextSprintEndDate) sprintStats.nextSprintEnd = formatDate(nextSprintEndDate);
  return sprintStats;
}

async function buildSprintGanttData({ jiraKey, jiraData, epics, token }) {
  if (!jiraKey) throw Object.assign(new Error('JIRA key is required'), { statusCode: 400 });
  const cleanToken = token;
  const baseUrl = JIRA_API_V2.BASE_URL;
  const jira = await getJira(cleanToken);
  logger.jira.fetch(jiraKey, 'SPRINT_GANTT_DATA', 'Fetching sprint Gantt data');
  let allTickets = [];
  if (epics && Array.isArray(epics)) {
    epics.forEach((feature) => {
      (feature.childEpics || []).forEach((epic) => {
        if (Array.isArray(epic.childTickets)) allTickets.push(...epic.childTickets);
      });
    });
  }
  if (allTickets.length === 0 && jiraData) {
    const sprintFieldA = getFieldId('sprint') || 'customfield_10020';
    const sprintFieldB = getFieldId('sprints') || 'customfield_10021';
    const childResponse = await jira.get(`${baseUrl}/rest/api/2/search`, {
      timeout: 30000,
      params: {
        jql: `parent = "${jiraKey}" OR "Epic Link" = "${jiraKey}"`,
        maxResults: 200,
        fields: `summary,status,assignee,issueType,sprint,${sprintFieldA},${sprintFieldB}`
      },
    });
    allTickets = (childResponse.data?.issues || []).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || 'Unknown',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      issueType: issue.fields.issuetype?.name || 'Unknown',
      sprint: issue.fields.sprint || issue.fields[sprintFieldA] || issue.fields[sprintFieldB]
    }));
  }
  const sprintBasedTickets = allTickets.filter((ticket) => {
    const issueType = (ticket.issueType || '').toUpperCase();
    return !issueType.includes('X-FEAT') && !issueType.includes('CAPABILITY') && !issueType.includes('FEATURE') && !issueType.includes('INITIATIVE') && !issueType.includes('EPIC');
  });
  const enrichedTickets = [];
  const sprintCache = new Map();
  for (const ticket of sprintBasedTickets) {
    const enrichedTicket = { ...ticket };
    if (ticket.sprint) {
      let sprintId;
      let sprintName;
      if (typeof ticket.sprint === 'object' && ticket.sprint.id) {
        sprintId = ticket.sprint.id;
        sprintName = ticket.sprint.name;
      } else if (typeof ticket.sprint === 'string') {
        const sprintMatch = ticket.sprint.match(/id=(\d+)/);
        const nameMatch = ticket.sprint.match(/name=([^,\]]+)/);
        sprintId = sprintMatch ? sprintMatch[1] : null;
        sprintName = nameMatch ? nameMatch[1] : ticket.sprint;
      }
      if (sprintId && !sprintCache.has(sprintId)) {
        try {
          const sprintResponse = await jira.get(`${baseUrl}/rest/agile/1.0/sprint/${sprintId}`, {
            timeout: 30000,
          });
          sprintCache.set(sprintId, {
            id: sprintId,
            name: sprintResponse.data.name || sprintName,
            startDate: sprintResponse.data.startDate ? new Date(sprintResponse.data.startDate).toISOString().split('T')[0] : null,
            endDate: sprintResponse.data.endDate ? new Date(sprintResponse.data.endDate).toISOString().split('T')[0] : null,
            state: sprintResponse.data.state
          });
        } catch (sprintErr) {
          logger.jira.fetch(jiraKey, 'SPRINT_FETCH_ERROR', `Error fetching sprint ${sprintId}:`, sprintErr.message);
        }
      }
      const sprintData = sprintCache.get(sprintId);
      if (sprintData) {
        enrichedTicket.sprintId = sprintData.id;
        enrichedTicket.sprintName = sprintData.name;
        enrichedTicket.sprintStartDate = sprintData.startDate;
        enrichedTicket.sprintEndDate = sprintData.endDate;
        enrichedTicket.sprintState = sprintData.state;
      }
    }
    enrichedTickets.push(enrichedTicket);
  }
  const timelineColumns = generateTimelineColumns();
  const sprintStats = calculateSprintStats(enrichedTickets, sprintCache);
  return {
    success: true,
    sprintTickets: enrichedTickets,
    timelineColumns,
    sprintStats,
    metadata: {
      totalTickets: allTickets.length,
      sprintBasedTickets: sprintBasedTickets.length,
      sprintsFound: sprintCache.size,
      dateRange: {
        start: timelineColumns[0]?.startDate || null,
        end: timelineColumns[timelineColumns.length - 1]?.endDate || null
      }
    }
  };
}

module.exports = {
  getReleaseCommitItems,
  getReleaseLongTermItems,
  fetchExecSummaryIssues,
  generateTimelineColumns,
  calculateSprintStats,
  buildSprintGanttData
};
