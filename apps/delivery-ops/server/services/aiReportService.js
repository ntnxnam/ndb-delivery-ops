const axios = require('axios');
const https = require('https');
const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { buildCommitItemsJQL } = require('../utils/jiraQueryUtils');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');
const { processAllMilestones } = require('../utils/milestoneProcessor');
const { getFieldId, getFieldValue, buildFieldIdsString } = require('../utils/jiraFieldsConfig');
const { formatDate } = require('../utils/dateFormatter');
const execSummaryService = require('./execSummaryService');

const naiHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function analyzeProjectRisk(jiraItem) {
  const fields = jiraItem.fields || {};
  const analysis = {
    resourceGaps: [],
    timelineIssues: [],
    qualityMetrics: null,
    riskReasons: null,
    documentationGaps: []
  };

  if (!fields.assignee) analysis.resourceGaps.push('No assignee assigned');
  const hasQaContact = fields[getFieldId('qaContact')]?.displayName || fields[getFieldId('qaContact')]?.name;
  const hasTestLead = fields[getFieldId('testLead')]?.displayName || fields[getFieldId('testLead')]?.name;
  if (!hasQaContact && !hasTestLead) analysis.resourceGaps.push('No QA/Testing resource assigned');
  if (!fields[getFieldId('tpmOwner')]) analysis.resourceGaps.push('No TPM Owner assigned');

  const today = new Date();
  const codeComplete = getFieldValue(fields, 'codeComplete');
  if (codeComplete) {
    const codeCompleteDate = new Date(codeComplete);
    if (!Number.isNaN(codeCompleteDate.getTime()) && codeCompleteDate < today && !fields.status?.name?.toLowerCase().includes('complete')) {
      const daysOverdue = Math.ceil((today - codeCompleteDate) / (1000 * 60 * 60 * 24));
      analysis.timelineIssues.push(`Code Complete overdue by ${daysOverdue} days`);
    }
  }

  const statusUpdateDateRaw = getFieldValue(fields, 'statusUpdateDate');
  if (statusUpdateDateRaw) {
    const statusUpdateDate = new Date(statusUpdateDateRaw);
    if (!Number.isNaN(statusUpdateDate.getTime())) {
      const daysSinceUpdate = Math.ceil((today - statusUpdateDate) / (1000 * 60 * 60 * 24));
      if (daysSinceUpdate > 7) analysis.timelineIssues.push(`Status update stale (${daysSinceUpdate} days old)`);
    }
  }

  const statusText = getFieldValue(fields, 'statusUpdate');
  if (typeof statusText === 'string') {
    const qiMatch = statusText.match(/QI[:\s]*(\d+)%/i);
    const bugMatch = statusText.match(/(\d+)\s*open\s*bugs?/i);
    const execMatch = statusText.match(/execution[:\s]*(\d+)%/i);
    analysis.qualityMetrics = {
      qi: qiMatch ? parseInt(qiMatch[1], 10) : null,
      openBugs: bugMatch ? parseInt(bugMatch[1], 10) : null,
      executionRate: execMatch ? parseInt(execMatch[1], 10) : null
    };
    analysis.riskReasons = extractRiskReasoning(jiraItem);
  }

  if (!getFieldValue(fields, 'requirementsLink')) analysis.documentationGaps.push('No requirements link');
  if (!getFieldValue(fields, 'tcmsLink')) analysis.documentationGaps.push('No TCMS link');
  return analysis;
}

function extractRiskReasoning(jiraItem) {
  const fields = jiraItem.fields || {};
  const riskField = getFieldValue(fields, 'riskIndicator') || fields[getFieldId('riskIndicator')];
  const statusUpdate = getFieldValue(fields, 'statusUpdate') || fields[getFieldId('statusUpdate')];
  const genericCategories = ['slight risk to plan', 'on track', 'at risk', 'high risk', 'critical', 'green', 'yellow', 'red', 'on plan', 'slight risk'];
  if (riskField) {
    let riskValue = '';
    if (typeof riskField === 'object' && riskField !== null) riskValue = riskField.value || riskField.name || String(riskField);
    else riskValue = String(riskField);
    const reasoningPatterns = [/(?:yellow|red|green)\s*[-:]\s*(.+)/i, /at\s+risk\s*[-:]\s*(.+)/i, /critical\s*[-:]\s*(.+)/i, /high\s+risk\s*[-:]\s*(.+)/i, /medium\s+risk\s*[-:]\s*(.+)/i];
    for (const pattern of reasoningPatterns) {
      const match = riskValue.match(pattern);
      if (match && match[1] && match[1].trim().length > 5) {
        const reasoning = match[1].trim().toLowerCase();
        if (!genericCategories.some((cat) => reasoning.includes(cat))) return match[1].trim();
      }
    }
  }
  if (statusUpdate && typeof statusUpdate === 'string') {
    const statusText = statusUpdate.trim();
    const statusRiskPatterns = [/(?:reason\s+for\s+(?:yellow|red|risk))[:\s]*([^.\n]{15,})/i, /(?:blocked\s+by)[:\s]*([^.\n]{10,})/i, /(?:waiting\s+(?:on|for))[:\s]*([^.\n]{10,})/i, /(?:concern|issue)[:\s]*([^.\n]{15,})/i, /(?:dependency\s+on)[:\s]*([^.\n]{10,})/i, /(?:resource\s+constraint)[:\s]*([^.\n]{10,})/i];
    for (const pattern of statusRiskPatterns) {
      const match = statusText.match(pattern);
      if (match && match[1] && match[1].trim().length > 10) return match[1].trim().replace(/\s+/g, ' ').substring(0, 100).trim();
    }
  }
  return null;
}

function analyzeProjectForExecutiveSummary(jiraItem) {
  const fields = jiraItem.fields || {};
  const analysis = { resourceStatus: [], timelineStatus: [], qualityIndicators: [], riskFactors: [], documentationStatus: [] };
  const riskReasoning = extractRiskReasoning(jiraItem);
  if (riskReasoning) analysis.riskFactors.unshift(`Risk Reason: ${riskReasoning}`);
  const qaContact = fields[getFieldId('qaContact')]?.displayName || fields[getFieldId('qaContact')]?.name;
  const testLead = fields[getFieldId('testLead')]?.displayName || fields[getFieldId('testLead')]?.name;
  const tpmOwner = fields[getFieldId('tpmOwner')]?.displayName || fields[getFieldId('tpmOwner')]?.name;
  const assignee = fields.assignee?.displayName || fields.assignee?.name;
  if (assignee) analysis.resourceStatus.push(`Dev: ${assignee}`); else analysis.resourceStatus.push('Dev: Unassigned');
  const primaryQA = qaContact || testLead;
  if (primaryQA) analysis.resourceStatus.push(`${qaContact ? 'QA' : 'Test Lead'}: ${primaryQA}`); else analysis.resourceStatus.push('QA: Unassigned');
  if (tpmOwner) analysis.resourceStatus.push(`TPM: ${tpmOwner}`); else analysis.resourceStatus.push('TPM: Unassigned');
  const ccDate = getFieldValue(fields, 'codeComplete');
  if (ccDate) {
    const date = new Date(ccDate);
    if (!Number.isNaN(date.getTime())) analysis.timelineStatus.push(`Code Complete: ${formatDate(date)}`);
  }
  const statusUpdateDate = getFieldValue(fields, 'statusUpdateDate');
  if (statusUpdateDate) {
    const date = new Date(statusUpdateDate);
    if (!Number.isNaN(date.getTime())) {
      const days = Math.ceil((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
      analysis.timelineStatus.push(days > 7 ? `Status stale (${days} days)` : `Updated ${days} days ago`);
    }
  } else {
    analysis.timelineStatus.push('No status update date available');
  }
  const statusText = getFieldValue(fields, 'statusUpdate');
  if (statusText && typeof statusText === 'string') {
    const qi = statusText.match(/QI[:\s]*(\d+)%/i);
    if (qi) analysis.qualityIndicators.push(`QI: ${parseInt(qi[1], 10)}%`);
  }
  if (getFieldValue(fields, 'requirementsLink')) analysis.documentationStatus.push('Requirements linked'); else analysis.documentationStatus.push('Requirements missing');
  if (getFieldValue(fields, 'tcmsLink')) analysis.documentationStatus.push('TCMS linked'); else analysis.documentationStatus.push('TCMS missing');
  return analysis;
}

function buildVPReportPrompt(releaseData) {
  const { version, totalProjects, p0BugsCount, riskCounts, projectDetails, dateMetrics, riskPercentages } = releaseData;
  const projectHeader = `${version} RELEASE STATUS ANALYSIS`;
  const projectSummaries = [];
  if (projectDetails.red?.length > 0) {
    projectSummaries.push(`HIGH RISK PROJECTS (${projectDetails.red.length}):`);
    projectDetails.red.forEach((project) => projectSummaries.push(`- ${project.key}: ${project.summary.substring(0, 40)}... Status: ${project.status}`));
  }
  return `${projectHeader}

CURRENT METRICS:
- Total Projects: ${totalProjects}
- Risk Distribution: ${riskPercentages.red}% RED / ${riskPercentages.yellow}% YELLOW / ${riskPercentages.green}% GREEN
- P0 Blocker Bugs: ${p0BugsCount}
- Days to Promotion Gate: ${dateMetrics.daysFromCutoff || 'TBD'}

DETAILED PROJECT STATUS:
${projectSummaries.join('\n')}

Provide executive summary, predictions, and concrete actions using the provided ticket facts only.`;
}

async function generateAiVpReport({ version, naiApiKey, jiraToken }) {
  let dateMetrics;
  try {
    const versionConfig = releaseVersionsEmailConfig.releaseGateDates[version];
    dateMetrics = versionConfig ? processAllMilestones(versionConfig) : { daysFromCutoff: null, currentCCDate: 'TBD', currentCGDate: 'TBD', currentPGDate: 'TBD', milestones: { codeComplete: [], commitGate: [], promotionGate: [], generalAvailability: [] } };
  } catch (_) {
    dateMetrics = { daysFromCutoff: null, currentCCDate: 'TBD', currentCGDate: 'TBD', currentPGDate: 'TBD', milestones: { codeComplete: [], commitGate: [], promotionGate: [], generalAvailability: [] } };
  }
  let p0BugsCount = 0;
  try {
    p0BugsCount = await execSummaryService.fetchP0BugsCount(jiraToken, version);
  } catch (_) {}
  let commitItems = [];
  const riskCounts = { red: 0, yellow: 0, green: 0, notSet: 0 };
  const projectDetails = { green: [], yellow: [], red: [] };
  try {
    const commitJQL = buildCommitItemsJQL(version);
    const fields = `key,summary,status,priority,assignee,${buildFieldIdsString(['riskIndicator','codeComplete','commitGate','promotionGate','statusUpdate','statusUpdateDate','qaContact','testLead','tpmOwner','requirementsLink','tcmsLink'])}`;
    const jira = await getJira(jiraToken);
    const commitResponse = await jira.get(JIRA_API_V2.SEARCH, {
      timeout: 30000,
      params: { jql: commitJQL, fields, maxResults: 1000 },
    });
    const rawItems = commitResponse.data?.issues || [];
    rawItems.forEach((item) => {
      const fieldsObj = item.fields || {};
      const riskField = getFieldValue(fieldsObj, 'riskIndicator');
      let riskLevel = 'notSet';
      if (riskField) {
        const riskValue = typeof riskField === 'object' ? (riskField.value || riskField.name || '') : String(riskField);
        const v = (riskValue || '').toLowerCase();
        if (v.includes('red') || v.includes('high') || v.includes('critical')) riskLevel = 'red';
        else if (v.includes('yellow') || v.includes('medium') || v.includes('at risk')) riskLevel = 'yellow';
        else if (v.includes('green') || v.includes('on track') || v.includes('low')) riskLevel = 'green';
      }
      riskCounts[riskLevel]++;
      const projectInfo = {
        key: item.key,
        summary: fieldsObj.summary || 'No summary',
        status: fieldsObj.status?.name || 'Unknown',
        priority: fieldsObj.priority?.name || 'Not Set',
        assignee: fieldsObj.assignee?.displayName || fieldsObj.assignee?.name || 'Unassigned',
        risk: riskLevel,
        codeCompleteDate: getFieldValue(fieldsObj, 'codeComplete') || null,
        commitGateDate: getFieldValue(fieldsObj, 'commitGate') || null,
        promotionGateDate: getFieldValue(fieldsObj, 'promotionGate') || null,
        statusUpdate: getFieldValue(fieldsObj, 'statusUpdate') || null,
        statusUpdateDate: getFieldValue(fieldsObj, 'statusUpdateDate') || null,
        qaContact: fieldsObj[getFieldId('qaContact')]?.displayName || fieldsObj[getFieldId('qaContact')]?.name || null,
        testLead: fieldsObj[getFieldId('testLead')]?.displayName || fieldsObj[getFieldId('testLead')]?.name || null,
        tpmOwner: fieldsObj[getFieldId('tpmOwner')]?.displayName || fieldsObj[getFieldId('tpmOwner')]?.name || null,
        requirementsLink: getFieldValue(fieldsObj, 'requirementsLink') || null,
        tcmsLink: getFieldValue(fieldsObj, 'tcmsLink') || null,
        automatedAnalysis: analyzeProjectForExecutiveSummary(item),
        projectRiskAnalysis: analyzeProjectRisk(item)
      };
      if (riskLevel !== 'notSet') projectDetails[riskLevel].push(projectInfo);
    });
    commitItems = rawItems;
  } catch (_) {}
  const releaseData = {
    version,
    totalProjects: commitItems.length,
    p0BugsCount,
    riskCounts,
    projectDetails,
    dateMetrics,
    generatedAt: new Date().toISOString(),
    riskPercentages: {
      red: commitItems.length > 0 ? Math.round((riskCounts.red / commitItems.length) * 100) : 0,
      yellow: commitItems.length > 0 ? Math.round((riskCounts.yellow / commitItems.length) * 100) : 0,
      green: commitItems.length > 0 ? Math.round((riskCounts.green / commitItems.length) * 100) : 0,
      notSet: commitItems.length > 0 ? Math.round((riskCounts.notSet / commitItems.length) * 100) : 0
    }
  };
  const vpPrompt = buildVPReportPrompt(releaseData);
  const naiResponse = await axios.post(
    'https://dpro-nai.corp.p10y.ntnxdpro.com/enterpriseai/v1/chat/completions',
    {
      model: 'eng-pool-05',
      messages: [
        { role: 'system', content: 'You are a technical program analyst creating executive Team Executive reports using only provided data.' },
        { role: 'user', content: vpPrompt }
      ],
      max_tokens: 4000,
      temperature: 0.3,
      top_p: 0.9
    },
    {
      headers: { Authorization: `Bearer ${naiApiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
      httpsAgent: naiHttpsAgent
    }
  );
  if (!naiResponse.data?.choices?.[0]?.message?.content) throw new Error('NAI API returned no content');
  return {
    teamExecReport: naiResponse.data.choices[0].message.content,
    releaseData,
    generatedAt: new Date().toISOString(),
    version
  };
}

module.exports = {
  analyzeProjectRisk,
  extractRiskReasoning,
  analyzeProjectForExecutiveSummary,
  buildVPReportPrompt,
  generateAiVpReport
};
