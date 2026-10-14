/**
 * Derive a short "what to do next" list from filtered dependency sections.
 * Pure — no JIRA / network.
 */

function isAsk(iss) {
  return iss && iss.commitState !== 'committed';
}

function isOpenish(iss) {
  const s = String(iss?.status || '').toLowerCase();
  if (!s) return true;
  return !['closed', 'done', 'complete', 'cancelled', 'canceled'].some((x) => s.includes(x));
}

/**
 * @param {object} counts
 * @returns {{ id: string, text: string, severity: 'high'|'med'|'low' }[]}
 */
export function buildNextActions({
  partnershipBlockedBy = [],
  partnershipBlocks = [],
  wishlist = [],
  wishlistLinked = [],
  wishlistLabelOnly = [],
  partnerOrphans = [],
} = {}) {
  const actions = [];

  const upstreamAsks = partnershipBlockedBy.filter((i) => isAsk(i) && isOpenish(i));
  if (upstreamAsks.length) {
    actions.push({
      id: 'upstream-ask',
      severity: 'high',
      text: `${upstreamAsks.length} upstream partnership item(s) still Ask / open — chase partner commit or unblock.`,
    });
  }

  const weOwe = partnershipBlocks.filter((i) => isOpenish(i));
  if (weOwe.length) {
    actions.push({
      id: 'we-owe',
      severity: 'high',
      text: `${weOwe.length} item(s) where they wait on us — clear or renegotiate before the next gate.`,
    });
  }

  const partnerAsks = wishlistLinked.filter((i) => isAsk(i) && isOpenish(i));
  if (partnerAsks.length) {
    actions.push({
      id: 'partner-ask',
      severity: 'high',
      text: `${partnerAsks.length} linked partner ticket(s) not committed — get fixVersion / Release Commit.`,
    });
  }

  const wlAsks = wishlist.filter((i) => isAsk(i) && isOpenish(i));
  if (wlAsks.length) {
    actions.push({
      id: 'wishlist-ask',
      severity: 'med',
      text: `${wlAsks.length} wishlist item(s) still Ask — decide commit vs defer and update JIRA.`,
    });
  }

  if (partnerOrphans.length) {
    actions.push({
      id: 'orphans',
      severity: 'med',
      text: `${partnerOrphans.length} partner orphan(s) (train-dep, no wishlist link) — link to a wishlist item or drop the label.`,
    });
  }

  if (wishlistLabelOnly.length) {
    actions.push({
      id: 'label-only',
      severity: 'low',
      text: `${wishlistLabelOnly.length} label-only / clone-only wishlist row(s) — add a real issue link so they appear on the map.`,
    });
  }

  if (!actions.length) {
    actions.push({
      id: 'clean',
      severity: 'low',
      text: 'No open chase items for the current filters — re-check after Pull, or widen Mode / Direction.',
    });
  }

  return actions.slice(0, 5);
}
