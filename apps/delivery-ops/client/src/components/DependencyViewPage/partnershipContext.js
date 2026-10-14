/**
 * Partnership wait language — always first person:
 *   "My <ticket> is waiting on this ticket"
 *   "This ticket is waiting on my <ticket>"
 * Uses issuelinks already on the row (no new JQL).
 */

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function isBlocksType(link) {
  const t = norm(link?.type);
  const n = norm(link?.typeName);
  return t === 'blocks' || n === 'blocks' || (t.includes('blocks') && !t.includes('blocked'));
}

function isBlockedByType(link) {
  const t = norm(link?.type);
  return t === 'is blocked by' || t.includes('blocked by');
}

/**
 * Related keys for a partnership row.
 * @param {'i_wait_on_them'|'they_wait_on_me'} direction
 * @returns {{ key: string, summary: string }[]}
 */
export function getWaitContext(issue, direction) {
  const links = Array.isArray(issue?.links) ? issue.links : [];
  const related = [];

  const pushRelated = (l) => {
    related.push({
      key: l.key,
      summary: l.summary || '',
      type: l.type || '',
      typeName: l.typeName || l.type || '',
    });
  };

  if (direction === 'i_wait_on_them') {
    // Row = their blocker. Related = my tickets waiting on them.
    links.forEach((l) => {
      if (!l?.key) return;
      if (isBlocksType(l) && l.direction === 'outward') pushRelated(l);
      if (isBlockedByType(l) && l.direction === 'inward') pushRelated(l);
    });
  } else if (direction === 'they_wait_on_me') {
    // Row = their ticket. Related = my tickets they are waiting on.
    links.forEach((l) => {
      if (!l?.key) return;
      if (isBlockedByType(l) && (l.direction === 'outward' || norm(l.type).includes('blocked by'))) {
        pushRelated(l);
      }
      if (isBlocksType(l) && l.direction === 'inward') pushRelated(l);
    });
  }

  const seen = new Set();
  return related.filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
}

/** Full sentence for tooltips / captions. */
export function formatWaitSentence(myKey, theirKey, direction, mySummary = '') {
  const mine = mySummary ? `${myKey} (${mySummary})` : myKey;
  if (direction === 'i_wait_on_them') {
    return `My ${mine} is waiting on ${theirKey}`;
  }
  return `Their ${theirKey} is waiting on my ${mine}`;
}

/**
 * One line for chip tooltips listing all my↔their pairs for this row.
 * @param {object} issue — the row ticket (their side in both partnership lanes)
 */
export function formatWaitContextLine(issue, direction) {
  const theirKey = issue?.key || 'this ticket';
  const ctx = getWaitContext(issue, direction);
  if (!ctx.length) {
    return direction === 'i_wait_on_them'
      ? `Could not find which of my tickets is waiting on ${theirKey} — open it in JIRA`
      : `Could not find which of my tickets ${theirKey} is waiting on — open it in JIRA`;
  }
  return ctx
    .slice(0, 3)
    .map((c) => formatWaitSentence(c.key, theirKey, direction, c.summary))
    .join(' · ');
}

/** Short chip label: "my FEAT-18400 waiting" / "waits on my ERA-1" */
export function formatWaitChipLabel(issue, direction) {
  const ctx = getWaitContext(issue, direction);
  if (!ctx.length) return '';
  const keys = ctx
    .slice(0, 2)
    .map((c) => c.key)
    .join(', ');
  if (direction === 'i_wait_on_them') {
    return `my ${keys} waiting`;
  }
  return `waits on my ${keys}`;
}

/**
 * Unique JIRA link type names for the wait relationship on a partnership row.
 * Falls back to all link typeNames when direction is not partnership-specific.
 */
export function getLinkTypeLabels(issue, direction) {
  const links = Array.isArray(issue?.links) ? issue.links : [];
  let pool = links;
  if (direction === 'i_wait_on_them' || direction === 'they_wait_on_me') {
    const ctx = getWaitContext(issue, direction);
    if (ctx.length) {
      pool = ctx;
    }
  }
  const seen = new Set();
  const out = [];
  pool.forEach((l) => {
    const label = String(l?.typeName || l?.type || '').trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  });
  return out;
}

/** Human label for Q6 commit evidence. */
export function formatCommitVia(issue) {
  const via = issue?.commitVia;
  const fvs = Array.isArray(issue?.commitFixVersions) ? issue.commitFixVersions : [];
  if (via === 'fixVersion') {
    return fvs.length === 1 ? `via fixVersion ${fvs[0]}` : 'via fixVersion';
  }
  if (via === 'release_commit_field') {
    return 'via Release Commit field';
  }
  if (via === 'both') {
    const fvBit = fvs.length === 1 ? `fixVersion ${fvs[0]}` : 'fixVersion';
    return `via ${fvBit} + field`;
  }
  return null;
}
