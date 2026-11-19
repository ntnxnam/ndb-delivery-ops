/**
 * Release type by dot notation (mirrors server sprintReleaseGates.releaseType).
 * Strip product prefix if present; strip pre-release suffix before counting dots.
 */

export const RELEASE_TYPE = {
  MAJOR_MINOR: 'Major/Minor',
  MAINTENANCE: 'Maintenance',
  PATCH: 'Patch',
  PRE_RELEASE: 'Pre-release',
  OTHER: 'Other',
};

const PRE_SUFFIXES = /^(EA|RC\d*|BETA|ALPHA|SNAPSHOT)$/i;

/**
 * @param {string} releaseName e.g. NDB-2.11, NDB-2.10.3.2, NDB-3.0-EA
 * @param {string} [prefix] e.g. NDB-
 */
export function getReleaseType(releaseName, prefix = '') {
  if (!releaseName) return RELEASE_TYPE.OTHER;
  let v;
  if (prefix && releaseName.startsWith(prefix)) v = releaseName.slice(prefix.length);
  else if (releaseName.includes('-')) v = releaseName.slice(releaseName.indexOf('-') + 1);
  else v = releaseName.replace(/^[A-Za-z][A-Za-z0-9]*[- ]/, '');

  if (v.includes('-')) {
    const [base, suffix] = v.split('-', 2);
    if (PRE_SUFFIXES.test(suffix)) return RELEASE_TYPE.PRE_RELEASE;
    v = base;
  }

  const dots = (v.match(/\./g) || []).length;
  if (dots === 1) return RELEASE_TYPE.MAJOR_MINOR;
  if (dots === 2) return RELEASE_TYPE.MAINTENANCE;
  if (dots === 3) return RELEASE_TYPE.PATCH;
  return RELEASE_TYPE.OTHER;
}

export function filterVersionsByType(versions, type, teamOrPrefix) {
  if (!type || !versions?.length) return versions || [];
  // Derive team prefix when a team object/array is passed
  let prefix = '';
  if (typeof teamOrPrefix === 'string') prefix = teamOrPrefix;
  else if (Array.isArray(teamOrPrefix)) prefix = teamOrPrefix[0] || '';
  else if (teamOrPrefix?.releasePrefixes?.[0]) prefix = teamOrPrefix.releasePrefixes[0];
  else if (teamOrPrefix?.releasePrefix) prefix = teamOrPrefix.releasePrefix;
  return versions.filter((v) => {
    const name = typeof v === 'string' ? v : v.name;
    return getReleaseType(name, prefix) === type;
  });
}

export const RELEASE_TYPE_CHIPS = [
  { id: RELEASE_TYPE.MAJOR_MINOR, label: '• Major/Minor', hint: '1 dot' },
  { id: RELEASE_TYPE.MAINTENANCE, label: '•• Maint', hint: '2 dots' },
  { id: RELEASE_TYPE.PATCH, label: '••• Patch', hint: '3 dots' },
  { id: RELEASE_TYPE.PRE_RELEASE, label: 'EA / RC', hint: 'suffix' },
];
