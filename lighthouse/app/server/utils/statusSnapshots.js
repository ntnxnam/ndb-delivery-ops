/**
 * Status snapshots storage and trends computation.
 * Stores per-fixVersion snapshots of all-status data (items + risk counts) and provides trends.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'status-snapshots.json');

const RISK_FIELD = 'customfield_23560';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readSnapshots() {
  ensureDataDir();
  if (!fs.existsSync(SNAPSHOTS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(SNAPSHOTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[statusSnapshots] Error reading snapshots:', e.message);
    return [];
  }
}

function writeSnapshots(snapshots) {
  ensureDataDir();
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2), 'utf8');
}

/**
 * Derive risk category from item's risk indicator (customfield_23560).
 * @param {object} item - Item with customfield_23560 (value/color or raw JIRA object)
 * @returns {'green'|'yellow'|'red'|'notSet'}
 */
function getRiskCategory(item) {
  const raw = item && item[RISK_FIELD];
  if (!raw) return 'notSet';
  const value = typeof raw === 'object' ? (raw.value || raw.name || '') : String(raw);
  const color = typeof raw === 'object' ? (raw.color || '').toLowerCase() : '';
  const v = (value || '').toLowerCase();
  if (color === '#dc3545' || color === 'red' || v.includes('red') || v.includes('high') || v.includes('critical')) return 'red';
  if (color === '#ffc107' || color === 'yellow' || v.includes('yellow') || v.includes('medium') || v.includes('at risk')) return 'yellow';
  if (color === '#28a745' || color === 'green' || v.includes('green') || v.includes('on track') || v.includes('low')) return 'green';
  return 'notSet';
}

/**
 * Build counts from items array.
 * @param {Array} items - Array of items with customfield_23560
 * @returns {{ green: number, yellow: number, red: number, notSet: number, total: number }}
 */
function computeCounts(items) {
  const counts = { green: 0, yellow: 0, red: 0, notSet: 0, total: items ? items.length : 0 };
  if (!items || !items.length) return counts;
  items.forEach((item) => {
    const cat = getRiskCategory(item);
    if (counts[cat] !== undefined) counts[cat]++;
  });
  return counts;
}

/**
 * Add a snapshot for a fix version.
 * @param {string} fixVersion - Fix version name
 * @param {Array} items - Full items array (as returned from release-items)
 * @returns {{ snapshotAt: string, fixVersion: string, counts: object, itemCount: number }}
 */
function addSnapshot(fixVersion, items) {
  if (!fixVersion || !Array.isArray(items)) {
    throw new Error('fixVersion and items array are required');
  }
  const snapshotAt = new Date().toISOString();
  const counts = computeCounts(items);
  const snapshot = {
    snapshotAt,
    fixVersion,
    items,
    counts: { ...counts }
  };
  const snapshots = readSnapshots();
  snapshots.push(snapshot);
  writeSnapshots(snapshots);
  return {
    snapshotAt,
    fixVersion,
    counts: snapshot.counts,
    itemCount: items.length
  };
}

/**
 * List snapshots for a fix version (newest first).
 * @param {string} fixVersion - Fix version to filter by
 * @returns {Array<{ snapshotAt: string, fixVersion: string, counts: object, itemCount: number }>}
 */
function listSnapshots(fixVersion) {
  const snapshots = readSnapshots();
  let list = fixVersion
    ? snapshots.filter((s) => s.fixVersion === fixVersion)
    : snapshots;
  list = list.map((s) => ({
    snapshotAt: s.snapshotAt,
    fixVersion: s.fixVersion,
    counts: s.counts || computeCounts(s.items),
    itemCount: (s.items && s.items.length) || 0
  }));
  list.sort((a, b) => new Date(b.snapshotAt) - new Date(a.snapshotAt));
  return list;
}

/**
 * Get time series and tasks-added deltas for a fix version.
 * @param {string} fixVersion - Fix version
 * @returns {{ points: Array<{ date: string, total: number, green, yellow, red, notSet, tasksAdded?: number }>, prediction?: { nextTotal?: number } }}
 */
function getTrends(fixVersion) {
  const list = listSnapshots(fixVersion);
  if (list.length === 0) {
    return { points: [], fixVersion };
  }
  const points = list.map((s) => ({
    date: s.snapshotAt,
    total: s.counts.total,
    green: s.counts.green || 0,
    yellow: s.counts.yellow || 0,
    red: s.counts.red || 0,
    notSet: s.counts.notSet || 0
  }));
  // Sort by date ascending for delta calculation
  points.sort((a, b) => new Date(a.date) - new Date(b.date));
  for (let i = 1; i < points.length; i++) {
    points[i].tasksAdded = Math.max(0, points[i].total - points[i - 1].total);
  }
  if (points[0]) points[0].tasksAdded = 0;

  let prediction;
  if (points.length >= 2) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const slope = last.total - prev.total;
    prediction = { nextTotal: Math.max(0, Math.round(last.total + slope)) };
  }

  return { fixVersion, points, prediction };
}

module.exports = {
  addSnapshot,
  listSnapshots,
  getTrends,
  computeCounts,
  getRiskCategory,
  readSnapshots,
  SNAPSHOTS_FILE
};
