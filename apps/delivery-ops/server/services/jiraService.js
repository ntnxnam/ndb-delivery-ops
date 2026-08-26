/**
 * JIRA presentation helpers (risk-indicator UI).
 *
 * HTTP lives in `shared/connectors/jiraConnector` via `utils/jiraClient`
 * (D40). Do not add axios / Bearer headers here.
 */

const {
  getJira,
  jiraGet,
  jiraPost,
  jiraPut,
  makeJiraSearchFetcher,
  searchPages,
  wrapJiraError,
} = require('../utils/jiraClient');

function formatRiskIndicator(value) {
  if (!value || value === null || value === undefined) {
    return { value: 'Not Set', color: 'transparent' };
  }

  let valueStr;
  if (typeof value === 'object') {
    valueStr = value.value || value.name || JSON.stringify(value);
  } else {
    valueStr = String(value);
  }

  if (!valueStr || valueStr.trim() === '') {
    return { value: 'Not Set', color: 'transparent' };
  }

  const valueLower = valueStr.toLowerCase();
  const firstPart = valueStr.split('-')[0].trim().toLowerCase();

  let color = 'transparent';
  if (firstPart.includes('red') || valueLower.includes('red') || valueLower.includes('high') || valueLower.includes('critical')) {
    color = '#dc3545';
  } else if (firstPart.includes('yellow') || valueLower.includes('yellow') || valueLower.includes('medium') || valueLower.includes('moderate') || valueLower.includes('at risk')) {
    color = '#ffc107';
  } else if (firstPart.includes('green') || valueLower.includes('green') || valueLower.includes('low') || valueLower.includes('minimal') || valueLower.includes('on track')) {
    color = '#28a745';
  }

  return { value: valueStr, color };
}

function getRiskIndicatorPriority(riskIndicator) {
  if (!riskIndicator) return 3;

  const color = riskIndicator.color ? riskIndicator.color.toLowerCase() : null;
  const value = riskIndicator.value || riskIndicator;

  if (!color || color === 'transparent') {
    if (typeof value === 'string') {
      const valueLower = value.toLowerCase();
      if (valueLower.includes('red') || valueLower.includes('high') || valueLower.includes('critical')) {
        return 0;
      }
      if (valueLower.includes('yellow') || valueLower.includes('medium') || valueLower.includes('moderate') || valueLower.includes('at risk')) {
        return 1;
      }
      if (valueLower.includes('green') || valueLower.includes('low') || valueLower.includes('minimal') || valueLower.includes('on track')) {
        return 2;
      }
    }
    return 3;
  }

  if (color === '#dc3545' || color === 'red' || color === '#de350b') return 0;
  if (color === '#ffc107' || color === 'yellow' || color === '#ff8b00') return 1;
  if (color === '#28a745' || color === 'green' || color === '#00875a') return 2;
  return 3;
}

function sortByRiskIndicator(items) {
  return items.sort((a, b) => {
    const priorityA = getRiskIndicatorPriority(a.customfield_23560);
    const priorityB = getRiskIndicatorPriority(b.customfield_23560);
    if (priorityA === priorityB) {
      return a.key.localeCompare(b.key);
    }
    return priorityA - priorityB;
  });
}

module.exports = {
  getJira,
  jiraGet,
  jiraPost,
  jiraPut,
  makeJiraSearchFetcher,
  searchPages,
  wrapJiraError,
  formatRiskIndicator,
  getRiskIndicatorPriority,
  sortByRiskIndicator,
};
