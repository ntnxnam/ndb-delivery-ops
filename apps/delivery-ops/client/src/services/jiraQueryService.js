/**
 * JIRA query service — ad-hoc JQL execution for the JiraQuery component.
 *
 * Previously an inline axios.post inside JiraQuery.js.
 * Import from here; never call /api/jira/query directly in a component.
 */

/**
 * Run an ad-hoc JQL query via the backend proxy.
 * @param {{ jql: string, fields?: string[], maxResults?: number }} params
 * @returns {Promise<{ issues: Array, total: number }>}
 */
export async function runJqlQuery({ jql, fields = [], maxResults = 50 }) {
  const res = await fetch('/api/jira/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields, maxResults }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`JQL query failed (${res.status}): ${text}`);
  }
  return res.json();
}
