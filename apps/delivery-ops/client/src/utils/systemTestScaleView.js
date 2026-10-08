/**
 * Client-side Current / Compare slicing for System-Test Scale.
 * Server returns all releases once; filters re-point into byRelease instantly.
 */

export function computeRag(curr) {
  const r2rOpen = curr?.r2rOpen?.count || 0;
  const anyOpen = curr?.anyOpen?.count || 0;
  const age90 = curr?.age90?.count || 0;
  const escape = curr?.rates?.escapeRate || 0;
  const open = curr?.open?.count || 0;
  if (r2rOpen > 0 || (anyOpen >= 3 && age90 >= 10)) {
    return {
      level: 'red',
      why: r2rOpen > 0
        ? `${r2rOpen} open release-to-release regression(s) still active.`
        : `${anyOpen} open regressions with ${age90} bugs aged ≥90d.`,
    };
  }
  if (anyOpen > 0 || escape >= 40 || open >= 15) {
    return {
      level: 'yellow',
      why: [
        anyOpen ? `${anyOpen} open typed regression(s)` : null,
        escape ? `escape rate ${escape}%` : null,
        open ? `${open} open System-Test bugs` : null,
      ].filter(Boolean).join(' · ') + '.',
    };
  }
  return {
    level: 'green',
    why: 'No open typed regressions; open volume and escape mix look controlled.',
  };
}

/**
 * @param {object|null} data - full dashboard payload
 * @param {string} currentRelease
 * @param {string} compareRelease
 */
export function selectReleaseView(data, currentRelease, compareRelease) {
  if (!data) {
    return {
      current: {},
      compare: {},
      rag: { level: 'yellow', why: 'No data yet.' },
      carry: null,
      components: [],
      activeCurrent: currentRelease || '',
      activeCompare: compareRelease || '',
    };
  }
  const releases = data.releases || [];
  const activeCurrent = currentRelease
    || data.currentRelease
    || releases[releases.length - 1]
    || '';
  const activeCompare = compareRelease
    || data.compareRelease
    || releases[0]
    || '';
  const by = data.byRelease || {};
  const current = by[activeCurrent] || data.current || {};
  const compare = by[activeCompare] || data.compare || {};
  const carryKey = `${activeCompare}->${activeCurrent}`;
  const carry = data.carry?.[carryKey] || null;
  const components = data.components?.[activeCurrent] || [];
  return {
    current,
    compare,
    rag: computeRag(current),
    carry,
    components,
    activeCurrent,
    activeCompare,
  };
}
