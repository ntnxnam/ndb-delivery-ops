const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { buildCommitItemsJQL } = require('../utils/jiraQueryUtils');
const { extractQIFromItem } = require('../utils/tcmsHelpers');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');
const { processAllMilestones } = require('../utils/milestoneProcessor');
const { getFieldId, getFieldValue, buildFieldIdsString } = require('../utils/jiraFieldsConfig');

const EXEC_FIELD_KEYS = [
  'riskIndicator',
  'statusUpdate',
  'statusUpdateDate',
  'qaContact',
  'testLead',
  'tpmOwner',
  'codeComplete',
  'commitGate',
  'promotionGate',
  'requirementsLink',
  'tcmsLink'
];

function getRiskFromItem(item) {
  const riskRaw = item.customfield_23560 || item.fields?.[getFieldId('riskIndicator')] || item.fields?.customfield_23560;
  if (!riskRaw) return 'not set';
  let value;
  if (typeof riskRaw === 'object' && riskRaw !== null) {
    value = riskRaw.value || riskRaw.name || String(riskRaw);
  } else {
    value = String(riskRaw);
  }
  return value.toLowerCase().trim();
}

function calculateRiskBreakdown(items) {
  const reds = items.filter((item) => {
    const risk = getRiskFromItem(item);
    return risk.includes('red') || risk.includes('big risk') || risk.includes('critical');
  });
  const yellows = items.filter((item) => {
    const risk = getRiskFromItem(item);
    return risk.includes('yellow') || risk.includes('slight risk') || risk.includes('at risk') || risk.includes('moderate');
  });
  const greens = items.filter((item) => {
    const risk = getRiskFromItem(item);
    return risk.includes('green') || risk.includes('on track') || risk.includes('low risk');
  });
  const notSet = items.filter((item) => {
    const risk = getRiskFromItem(item);
    return risk.includes('not set') || risk === '';
  });
  return { green: greens.length, yellow: yellows.length, red: reds.length, notSet: notSet.length, total: items.length };
}

function generateExecutiveSummary(version, commitItems, riskCounts, breakdownData = {}) {
  const total = commitItems.length;
  if (total === 0) {
    return {
      executiveSummary: `No commit projects found for ${version}.`,
      riskBreakdown: '',
      highlights: '',
      lowlights: '',
      actionItems: ''
    };
  }

  const reds = commitItems.filter((item) => getRiskFromItem(item).includes('red'));
  const yellows = commitItems.filter((item) => getRiskFromItem(item).includes('yellow') || getRiskFromItem(item).includes('slight risk'));
  const greens = commitItems.filter((item) => getRiskFromItem(item).includes('green'));
  const notSet = commitItems.filter((item) => getRiskFromItem(item).includes('not set'));

  let breakdownAnalysis = null;
  if (breakdownData && Object.keys(breakdownData).length > 0) {
    let totalSubTasks = 0;
    let totalDone = 0;
    let totalToBeVerified = 0;
    let totalInProgress = 0;
    let totalRemaining = 0;
    let projectsWithBreakdown = 0;
    Object.values(breakdownData).forEach((data) => {
      if (data && data.overallStats) {
        projectsWithBreakdown++;
        totalSubTasks += data.total || 0;
        totalDone += data.overallStats.done || 0;
        totalToBeVerified += data.overallStats.toBeVerified || 0;
        totalInProgress += data.overallStats.inProgress || 0;
        totalRemaining += (data.overallStats.toDo || 0) + (data.overallStats.blocked || 0) + (data.overallStats.other || 0);
      }
    });
    if (totalSubTasks > 0) {
      breakdownAnalysis = {
        projectsWithBreakdown,
        totalSubTasks,
        totalDone,
        totalToBeVerified,
        totalInProgress,
        totalRemaining,
        completionRate: ((totalDone / totalSubTasks) * 100).toFixed(1),
        verificationBacklog: totalToBeVerified > 0 ? ((totalToBeVerified / totalSubTasks) * 100).toFixed(1) : '0'
      };
    }
  }

  let execText = `The ${version} release shows `;
  if (greens.length > reds.length + yellows.length) execText += `strong execution across ${total} committed projects with ${greens.length} projects (${Math.round(greens.length / total * 100)}%) maintaining Green status. `;
  else execText += `mixed execution requiring focused attention across ${total} committed projects. `;
  if (reds.length > 0) execText += `${reds.length} projects at big risk (${Math.round(reds.length / total * 100)}%) and `;
  if (yellows.length > 0) execText += `${yellows.length} projects at slight risk (${Math.round(yellows.length / total * 100)}%) `;
  execText += 'require immediate management focus as critical gate milestones approach.';
  if (breakdownAnalysis) execText += ` Sub-task analysis across ${breakdownAnalysis.projectsWithBreakdown} projects reveals ${breakdownAnalysis.totalSubTasks} tasks with ${breakdownAnalysis.completionRate}% completion rate.`;

  const riskBreakdown = `
| Risk Level | Count | Percentage |
|------------|-------|------------|
| 🟢 Green - On Track | ${greens.length} | ${Math.round(greens.length / total * 100)}% |
| 🟡 Yellow - Slight Risk | ${yellows.length} | ${Math.round(yellows.length / total * 100)}% |
| 🔴 Red - Big Risk | ${reds.length} | ${Math.round(reds.length / total * 100)}% |
| ⚪ Not Set | ${notSet.length} | ${Math.round(notSet.length / total * 100)}% |
| **TOTAL COMMIT** | **${total}** | **100%** |
`;

  let highlights = '';
  if (greens.length > 0) {
    highlights = '## Highlights (Execution Wins)\n';
    greens.slice(0, 5).forEach((item) => {
      const qi = extractQIFromItem(item);
      highlights += `• **${item.summary}** (${item.key}) - ${item.priority || 'Major'} - ${item.status || 'In Progress'}`;
      if (qi) highlights += ` - QI: ${qi}%`;
      highlights += '\n';
    });
  }

  return {
    executiveSummary: execText,
    riskBreakdown,
    highlights,
    lowlights: '',
    actionItems: '## Action Items\n',
    totalProjects: total,
    riskCounts: { red: reds.length, yellow: yellows.length, green: greens.length, notSet: notSet.length },
    breakdownAnalysis
  };
}

function calculateDateMetrics(version) {
  const versionConfig = releaseVersionsEmailConfig.releaseGateDates?.[version];
  if (!versionConfig) {
    return {
      daysFromCutoff: null,
      currentCCDate: 'TBD',
      currentCGDate: 'TBD',
      currentPGDate: 'TBD',
      milestones: { codeComplete: [], commitGate: [], promotionGate: [], generalAvailability: [] }
    };
  }
  return processAllMilestones(versionConfig);
}

async function fetchP0BugsCount(token, version) {
  const filterName = `${version.toLowerCase()}-all`;
  const p0JqlQuery = `filter = "${filterName}" AND statusCategory != Done AND priority = "P0 - Blocker"`;
  const jira = await getJira(token);
  const total = await jira.searchCount(p0JqlQuery);
  return total || 0;
}

async function fetchCommitItems(token, version) {
  const commitJQL = buildCommitItemsJQL(version);
  const customFields = buildFieldIdsString(EXEC_FIELD_KEYS);
  const fields = `key,summary,status,priority,assignee,${customFields}`;
  const jira = await getJira(token);
  const response = await jira.get(JIRA_API_V2.SEARCH, {
    timeout: 30000,
    params: { jql: commitJQL, fields, maxResults: 1000 },
  });
  return response.data?.issues || [];
}

module.exports = {
  EXEC_FIELD_KEYS,
  generateExecutiveSummary,
  calculateRiskBreakdown,
  calculateDateMetrics,
  fetchP0BugsCount,
  fetchCommitItems,
  getRiskFromItem
};
