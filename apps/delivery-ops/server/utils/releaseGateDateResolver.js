/**
 * Release gate date resolver — single SoT for default picking.
 * Source: releaseVersionsEmailConfig.json solid GA > dotted GA > null.
 * JIRA releaseDate is fallback only (handled by caller).
 */
const fs = require('fs');
const path = require('path');

const GATE_CONFIG_PATH = path.join(__dirname, '..', 'config', 'releaseVersionsEmailConfig.json');

let cache = null;
let cacheMtime = 0;

function loadGateDates() {
  try {
    const stat = fs.statSync(GATE_CONFIG_PATH);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const raw = JSON.parse(fs.readFileSync(GATE_CONFIG_PATH, 'utf8'));
    cache = raw.releaseGateDates || {};
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (_) {
    return cache || {};
  }
}

/**
 * Resolve effective GA date for a version name.
 * Prefers latest solid GA, then latest dotted GA.
 * @param {string} versionName e.g. "NDB-2.12"
 * @returns {string|null} ISO date YYYY-MM-DD or null
 */
function getGateGaDate(versionName) {
  if (!versionName || typeof versionName !== 'string') return null;
  const gates = loadGateDates()[versionName];
  if (!gates || typeof gates !== 'object') return null;
  const gaEntries = Object.entries(gates)
    .filter(([k, v]) => k.toLowerCase().startsWith('ga') && v && typeof v.date === 'string')
    .map(([k, v]) => ({ key: k, date: v.date.trim(), style: v.style || 'solid' }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  if (gaEntries.length === 0) return null;
  const solid = gaEntries.filter((e) => e.style === 'solid').sort((a, b) => b.date.localeCompare(a.date));
  if (solid.length > 0) return solid[0].date;
  const dotted = gaEntries.sort((a, b) => b.date.localeCompare(a.date));
  return dotted[0].date;
}

function clearGateDateCache() {
  cache = null;
  cacheMtime = 0;
}

module.exports = { getGateGaDate, clearGateDateCache, loadGateDates };
