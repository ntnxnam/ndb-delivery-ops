/**
 * Map curated release gate dates (releaseVersionsEmailConfig.json →
 * releaseGateDates) onto the sprint-slot calendar used by the Sprint
 * Performance report, so the discipline timeline can mark CC / CG / PG / GA.
 */

const fs = require('fs');
const path = require('path');

const GATE_CONFIG_PATH = path.join(__dirname, '..', 'config', 'releaseVersionsEmailConfig.json');
const DAY_MS = 86400000;
const KINDS = ['EC', 'CCM', 'CG', 'PG', 'GA'];

function loadGateConfig() {
  try {
    return JSON.parse(fs.readFileSync(GATE_CONFIG_PATH, 'utf8')).releaseGateDates || {};
  } catch (e) {
    console.warn('[sprintReleaseGates] could not read release gate config:', e.message);
    return {};
  }
}

function releaseType(name, prefix) {
  const v = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  if (/-[A-Za-z]/.test(v)) return 'Pre-release';
  const dots = (v.match(/\./g) || []).length;
  return dots === 1 ? 'Major/Minor' : dots === 2 ? 'Maintenance' : dots === 3 ? 'Patch' : 'Other';
}

/**
 * @param {{ anchor: {startIso: string, number: number}, sprintDays: number, firstSlot: number, lastSlot: number, releasePrefix?: string }} cal
 * @returns {Array<{release, type, gates: Array<{kind, label, iso, style, color, slot, frac}>}>}
 */
function releaseGatesForSlots(cal) {
  let parse;
  try {
    ({ parseReleaseGateTimeline: parse } = require('@portfolio-delivery-ops/shared'));
  } catch (e) {
    console.warn('[sprintReleaseGates] shared gate parser unavailable:', e.message);
    return [];
  }
  const anchorMs = new Date(cal.anchor.startIso).getTime();
  const span = cal.sprintDays * DAY_MS;
  const slotPos = (iso) => cal.anchor.number + (new Date(iso).getTime() - anchorMs) / span;
  return Object.entries(loadGateConfig())
    .filter(([name]) => !cal.releasePrefix || name.startsWith(cal.releasePrefix))
    .map(([name, versionConfig]) => {
      const gates = parse(name, { versionConfig }).gates
        .filter((g) => KINDS.includes(g.kind))
        .map((g) => {
          const pos = slotPos(g.iso);
          const slot = Math.floor(pos);
          return { kind: g.kind, label: g.label, iso: g.iso, style: g.style, color: g.color, slot, frac: Number((pos - slot).toFixed(3)) };
        })
        .filter((g) => g.slot >= cal.firstSlot && g.slot <= cal.lastSlot);
      return { release: name, type: releaseType(name, cal.releasePrefix), gates };
    })
    .filter((r) => r.gates.length)
    .sort((x, y) => x.gates[0].iso.localeCompare(y.gates[0].iso));
}

module.exports = { releaseGatesForSlots, releaseType };
