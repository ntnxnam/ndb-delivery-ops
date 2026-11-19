/**
 * Map Feature Dashboard canonical issues → Status Sender epic table rows.
 * Columns: Key, Issue Type, Summary, Status, Resolution, Assignee,
 * QA Contact, Due Date, Fix Version — Status Sender value shapes.
 */

import { formatDueDate } from '../../shared/utils/dateFormatter';

const FEATURE_TYPES = new Set(['feature', 'initiative']);
const LEVEL1_TYPES = new Set(['x-feat', 'capability']);
const EPIC_TYPE = 'epic';

function formatFixVersions(fixVersions) {
  if (Array.isArray(fixVersions)) {
    return fixVersions.length > 0 ? fixVersions.join(', ') : 'N/A';
  }
  if (typeof fixVersions === 'string' && fixVersions.trim()) return fixVersions.trim();
  return 'N/A';
}

/** One Status Sender table row (feature or epic). */
export function toStatusSenderEpicRow(issue, fallbackType = 'Epic') {
  const qa = issue?.qaContact;
  return {
    key: issue?.key || 'N/A',
    summary: issue?.summary || 'N/A',
    status: issue?.status || 'N/A',
    issueType: issue?.issueType || fallbackType,
    resolution: issue?.resolution || 'N/A',
    assignee: issue?.assignee || 'N/A',
    customfield_10860: {
      name: 'QA Contact',
      value: qa || 'Not Set',
    },
    duedate: formatDueDate(issue?.duedate),
    fixVersions: formatFixVersions(issue?.fixVersions),
  };
}

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/i;

/** Flatten child epic keys from Status Sender epics hierarchy. */
export function collectChildEpicKeys(epics) {
  if (!Array.isArray(epics)) return [];
  const keys = [];
  for (const feature of epics) {
    for (const epic of feature.childEpics || []) {
      const k = String(epic?.key || '').trim();
      if (JIRA_KEY_RE.test(k)) keys.push(k);
    }
  }
  return keys;
}

/**
 * Exact-set JQL for displayed epics (authenticity clickthrough — no builder change).
 * Falls back to null when there are no keys.
 */
export function buildTotalEpicsJql(epics) {
  const keys = collectChildEpicKeys(epics);
  if (keys.length === 0) return null;
  return `key in (${keys.join(', ')})`;
}

export function jiraIssuesSearchUrl(jiraBaseUrl, jql) {
  if (!jiraBaseUrl || !jql) return '';
  return `${String(jiraBaseUrl).replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Build hierarchical Features → child Epics from Feature Dashboard payload.canonical.
 * Mirrors Status Sender parent-link matching used by /api/jira/fetch-all-jira-tickets.
 *
 * @param {object[]} canonicalIssues - Feature Dashboard payload.canonical
 * @param {string} featureKey - Root ticket key
 * @param {{ rootIssueType?: string }} [options]
 * @returns {object[]|null} Status Sender `epics` array, or null if nothing usable
 */
export function buildEpicsFromFeatureDashboard(canonicalIssues, featureKey, options = {}) {
  if (!Array.isArray(canonicalIssues) || canonicalIssues.length === 0 || !featureKey) {
    return null;
  }

  const rootKey = String(featureKey).trim();
  const rootIssueType = String(options.rootIssueType || '').toLowerCase();
  const isLevel1Root = LEVEL1_TYPES.has(rootIssueType);

  let featuresAndInitiatives = canonicalIssues.filter((i) =>
    FEATURE_TYPES.has(String(i.issueType || '').toLowerCase())
  );

  // X-FEAT / Capability: only Features/Initiatives whose Parent Link points at the root
  // (matches /api/jira/fetch-all-jira-tickets Level-1 filtering).
  if (isLevel1Root) {
    featuresAndInitiatives = featuresAndInitiatives.filter(
      (f) => f.parentLink === rootKey
    );
  }

  const allEpics = canonicalIssues.filter(
    (i) => String(i.issueType || '').toLowerCase() === EPIC_TYPE
  );

  if (featuresAndInitiatives.length === 0 && allEpics.length === 0) {
    return null;
  }

  let orderedFeatures = featuresAndInitiatives;
  const rootFeature = featuresAndInitiatives.find((f) => f.key === rootKey);

  if (isLevel1Root) {
    // Level-1 root is not itself a Feature row — only its child Features
    orderedFeatures = featuresAndInitiatives;
    if (orderedFeatures.length === 0 && allEpics.length > 0) {
      orderedFeatures = [
        {
          key: rootKey,
          summary: rootKey,
          issueType: options.rootIssueType || 'X-FEAT',
          status: 'N/A',
          resolution: null,
          assignee: null,
          qaContact: null,
          duedate: null,
          fixVersions: [],
        },
      ];
    }
  } else if (rootFeature) {
    orderedFeatures = [
      rootFeature,
      ...featuresAndInitiatives.filter((f) => f.key !== rootKey),
    ];
  } else if (featuresAndInitiatives.length === 0) {
    orderedFeatures = [
      {
        key: rootKey,
        summary: rootKey,
        issueType: 'Feature',
        status: 'N/A',
        resolution: null,
        assignee: null,
        qaContact: null,
        duedate: null,
        fixVersions: [],
      },
    ];
  }

  const featureKeys = new Set(orderedFeatures.map((f) => f.key));
  // For Level-1, "root" for orphan-epic attachment is each Feature, not the X-FEAT
  const orphanAttachRoot = isLevel1Root ? null : rootKey;

  return orderedFeatures.map((feature) => {
    const featureKeyLocal = feature.key;
    const childEpics = allEpics
      .filter((epic) => {
        const parentKey = epic.parentLink || null;
        if (parentKey === featureKeyLocal) return true;

        // Feature/Initiative root: include related epics without parent pointing at another feature
        if (orphanAttachRoot && featureKeyLocal === orphanAttachRoot) {
          if (!parentKey) return true;
          if (!featureKeys.has(parentKey) || parentKey === orphanAttachRoot) return true;
          return false;
        }
        return false;
      })
      .map((epic) => toStatusSenderEpicRow(epic, 'Epic'));

    return {
      ...toStatusSenderEpicRow(feature, feature.issueType || 'Feature'),
      childEpics,
    };
  });
}
