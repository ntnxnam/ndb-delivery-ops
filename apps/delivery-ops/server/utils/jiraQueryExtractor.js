/**
 * Extract JIRA queries from Confluence content
 * Queries are typically in format: Jira(query)
 */

function extractJiraQueries(content) {
  if (!content) return [];
  
  const queries = [];
  const queryPattern = /Jira\(([^)]+)\)/gi;
  let match;
  
  while ((match = queryPattern.exec(content)) !== null) {
    queries.push({
      query: match[1],
      fullMatch: match[0],
      index: match.index
    });
  }
  
  return queries;
}

/**
 * Map query to section/category based on context
 */
function mapQueryToSection(query, content) {
  // Try to find the section name before the query
  const beforeQuery = content.substring(0, content.indexOf(query.fullMatch));
  const lines = beforeQuery.split('\n').reverse().slice(0, 5); // Last 5 lines before query
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Check for common section headers
    if (trimmed.match(/^(Dev Tasks|QA Tasks|Product Bugs|Test Bugs|Requirements|UX|Tech Design|API Review|Dev Tickets|UI|Coding|UT|Test Plan|Test Tickets|Test Automation|Test Framework)/i)) {
      return trimmed;
    }
  }
  
  return 'Unknown';
}

/**
 * Determine query type based on query content
 */
function getQueryType(query) {
  const q = query.toLowerCase();
  
  if (q.includes('statuscategory=done') || q.includes('status = done')) {
    return 'done';
  }
  if (q.includes('sprint in opensprints')) {
    return 'current_sprint';
  }
  if (q.includes('sprint in futuresprints')) {
    return 'future_sprint';
  }
  if (q.includes('sprint in closedsprints') || q.includes('sprint is empty')) {
    return 'no_sprint';
  }
  
  return 'all';
}

module.exports = {
  extractJiraQueries,
  mapQueryToSection,
  getQueryType
};

