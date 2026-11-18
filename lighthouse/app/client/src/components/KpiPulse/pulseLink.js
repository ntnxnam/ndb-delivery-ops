const DEFAULT_JIRA = 'https://jira.nutanix.com';

export function jiraIssuesHref(jiraBaseUrl, jql) {
  if (!jql) return null;
  const base = String(jiraBaseUrl || DEFAULT_JIRA).replace(/\/+$/, '');
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`;
}

export function formatHeroValue(cell) {
  if (cell == null) return '—';
  const v = cell.count;
  if (v == null) return '—';
  if (typeof v === 'number' && cell.unit === 'days') {
    return `${v}d`;
  }
  if (cell.label != null && cell.createdCount != null) return cell.label;
  return String(v);
}
