/**
 * Confluence API service — all Confluence and JIRA populate calls in one place.
 *
 * Previously scattered as inline axios calls inside ConfluenceExtractor.js.
 * Import from here; never call these endpoints directly in a component.
 */

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${url} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Trigger JIRA data population for a Confluence page.
 * @param {{ pageId: string, spaceKey: string }} params
 */
export async function populateJiraData(params) {
  return post('/api/jira/populate-data', params);
}

/**
 * Push populated data into a Confluence page.
 * @param {{ pageId: string, content: string }} params
 */
export async function populateConfluencePage(params) {
  return post('/api/confluence/populate', params);
}

/**
 * Extract structured data from a Confluence page.
 * @param {{ pageId: string }} params
 */
export async function extractConfluencePage(params) {
  return post('/api/confluence/extract', params);
}
