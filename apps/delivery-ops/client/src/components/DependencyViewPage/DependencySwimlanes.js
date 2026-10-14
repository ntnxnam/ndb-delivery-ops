import React, { useMemo } from 'react';
import TicketChip, { targetDateMeta } from './TicketChip';
import { browseUrl } from './hygiene';

const EW_LANES = [
  { id: 'global_ew', title: 'Global EW', hint: 'global-ew', tone: 'global' },
  { id: 'nutanix_ew', title: 'Nutanix EW', hint: 'nutanix-ew · ENG/NCN/…', tone: 'nutanix' },
  { id: 'ndb_ew', title: 'Peer NDB', hint: 'ndb-ew · still NDB', tone: 'ndb' },
  { id: 'team_internal', title: 'Unparked / FYI', hint: 'no EW park', tone: 'fyi' },
];

const HOME_PROJECTS = new Set(['ERA', 'FEAT']);
const MAX_DEPTH = 5;

function spanIdOf(iss) {
  return String(iss?.spanInfo?.id || iss?.span || 'team_internal');
}

function projectOfKey(key) {
  const m = String(key || '').match(/^([A-Z][A-Z0-9_]+)-/i);
  return m ? m[1].toUpperCase() : '';
}

function isHomeKey(key, project) {
  const pk = String(project || projectOfKey(key) || '').toUpperCase();
  return HOME_PROJECTS.has(pk) || pk.startsWith('NDB');
}

function shortSummary(summary, max = 56) {
  const s = String(summary || '').trim();
  if (!s) return '(no summary)';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fixVersionLabel(issue) {
  if (!issue) return null;
  const real = issue.commitFixVersions;
  if (Array.isArray(real) && real.length) return real.join(', ');
  const raw = issue.fixVersions;
  if (Array.isArray(raw) && raw.length) return raw.join(', ');
  return null;
}

function linkLooksLikeBlocks(link) {
  const t = `${link?.type || ''} ${link?.typeName || ''}`.toLowerCase();
  if (t.includes('clone') || t.includes('duplicat') || t.includes('relates')) return false;
  if (t.includes('blocked by') || t.includes('is blocked by')) return true;
  if (t.includes('blocks')) return true;
  if (t.includes('depend')) return true;
  if (t.includes('needed for') || t.includes('has to be done')) return true;
  return false;
}

function linkTypeText(link) {
  return `${link?.type || ''} ${link?.typeName || ''}`.toLowerCase();
}

function isBlockedByWording(t) {
  return t.includes('blocked by') || t.includes('is blocked by');
}

function isBlocksWording(t) {
  // "blocks" but not "blocked by"
  return t.includes('blocks') && !isBlockedByWording(t);
}

/** Keys that this ticket waits on (upstream blockers). */
function upstreamKeysFromIssue(issue) {
  const keys = [];
  (issue?.links || []).forEach((link) => {
    if (!link?.key || !linkLooksLikeBlocks(link)) return;
    const t = linkTypeText(link);
    // Outward "is blocked by" X, or inward "blocks" from X, or depend/needed-for wording
    const waitsOn =
      (link.direction === 'outward' &&
        (isBlockedByWording(t) || t.includes('depend') || t.includes('needed for') || t.includes('has to be done after'))) ||
      (link.direction === 'inward' && (isBlocksWording(t) || t.includes('has to be done before')));
    if (waitsOn) keys.push(link.key);
  });
  return [...new Set(keys)];
}

/** Keys that wait on this ticket (we block them / they are blocked by us). */
function downstreamKeysFromIssue(issue) {
  const keys = [];
  (issue?.links || []).forEach((link) => {
    if (!link?.key || !linkLooksLikeBlocks(link)) return;
    const t = linkTypeText(link);
    const theyWait =
      (link.direction === 'outward' &&
        (isBlocksWording(t) || t.includes('has to be done before') || t.includes('is needed for'))) ||
      (link.direction === 'inward' && isBlockedByWording(t));
    if (theyWait) keys.push(link.key);
  });
  return [...new Set(keys)];
}

/** Any dependency-like linked key (direction-agnostic fallback). */
function allDependencyLinkKeys(issue) {
  return [
    ...new Set(
      (issue?.links || [])
        .filter((l) => l?.key && linkLooksLikeBlocks(l))
        .map((l) => l.key)
    ),
  ];
}

/**
 * Who waits on targetKey — scan every issue's upstream list + target's downstream links.
 */
function findWaitersOf(targetKey, allIssues) {
  const waiters = new Set();
  (allIssues || []).forEach((iss) => {
    if (!iss?.key || iss.key === targetKey) return;
    if (upstreamKeysFromIssue(iss).includes(targetKey)) waiters.add(iss.key);
    // Partner ticket that only has "is blocked by" us in reverse scan
    if (allDependencyLinkKeys(iss).includes(targetKey) && !isHomeKey(iss.key, iss.project)) {
      // Non-home issue linked to our home ticket — likely the partner waiting on us
      if (isHomeKey(targetKey)) waiters.add(iss.key);
    }
  });
  return [...waiters];
}

function stubFromLink(link) {
  return {
    key: link.key,
    summary: link.summary || link.key,
    project: link.project || projectOfKey(link.key),
    labels: link.labels || [],
    status: link.status || '',
    issueType: link.issueType || '',
    links: [],
    span: isHomeKey(link.key, link.project) ? 'ndb_ew' : 'nutanix_ew',
    spanInfo: {
      id: isHomeKey(link.key, link.project) ? 'ndb_ew' : 'nutanix_ew',
      short: isHomeKey(link.key, link.project) ? 'Peer NDB' : 'Nutanix',
      source: 'inferred_link_stub',
    },
    _stub: true,
  };
}

/** Prefer a fully fetched issue over a thin link stub. */
function pickRicherIssue(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const score = (iss) => {
    let n = 0;
    if (iss.status) n += 4;
    if (iss.issueType) n += 2;
    if (iss.targetDate || iss.endDate) n += 1;
    if (Array.isArray(iss.fixVersions) && iss.fixVersions.length) n += 1;
    if (!iss._stub) n += 3;
    if (Array.isArray(iss.links) && iss.links.length) n += 1;
    if (Array.isArray(iss.ancestorChain) && iss.ancestorChain.length > 1) n += 2;
    return n;
  };
  const primary = score(b) > score(a) ? b : a;
  const secondary = primary === a ? b : a;
  const chain =
    (Array.isArray(primary.ancestorChain) && primary.ancestorChain.length
      ? primary.ancestorChain
      : null) ||
    (Array.isArray(secondary.ancestorChain) && secondary.ancestorChain.length
      ? secondary.ancestorChain
      : null);
  return {
    ...secondary,
    ...primary,
    status: primary.status || secondary.status || '',
    issueType: primary.issueType || secondary.issueType || '',
    summary: primary.summary || secondary.summary || '',
    ancestorChain: chain,
    _stub: Boolean(primary._stub && secondary._stub),
  };
}

/**
 * Top-level → … → linked ticket. Ancestors are crumbs; linked issue is emphasized separately.
 */
function HierarchyTrail({ issue, jiraBaseUrl }) {
  const chain = Array.isArray(issue?.ancestorChain) ? issue.ancestorChain : [];
  if (chain.length < 2) return null;
  const ancestors = chain.slice(0, -1);
  return (
    <div className="dv-hierarchy" aria-label="Parent hierarchy">
      <span className="dv-hierarchy-label">From</span>
      {ancestors.map((anc, i) => (
        <React.Fragment key={anc.key}>
          {i > 0 ? <span className="dv-hierarchy-sep">›</span> : null}
          <a
            className={`dv-hierarchy-node${i === 0 ? ' dv-hierarchy-node--top' : ''}`}
            href={browseUrl(jiraBaseUrl, anc.key)}
            target="_blank"
            rel="noopener noreferrer"
            title={[anc.summary, anc.key, anc.issueType, anc.status].filter(Boolean).join('\n')}
          >
            {anc.issueType ? <span className="dv-hierarchy-type">{anc.issueType}</span> : null}
            <span className="dv-hierarchy-sum">{shortSummary(anc.summary, 42)}</span>
            <span className="dv-chip-key">{anc.key}</span>
          </a>
        </React.Fragment>
      ))}
      <span className="dv-hierarchy-sep">›</span>
      <span className="dv-hierarchy-linked-label">linked</span>
    </div>
  );
}

function withHierarchy(node, jiraBaseUrl, inner) {
  const chain = Array.isArray(node?.ancestorChain) ? node.ancestorChain : [];
  if (chain.length < 2) return inner;
  return (
    <div className="dv-project-stack">
      <HierarchyTrail issue={node} jiraBaseUrl={jiraBaseUrl} />
      <div className="dv-project-linked">{inner}</div>
    </div>
  );
}

function indexIssues(issueLists) {
  const byKey = new Map();
  const linkStubs = new Map(); // key → stub from someone's link

  issueLists.flat().forEach((iss) => {
    if (!iss?.key) return;
    byKey.set(iss.key, iss);
    (iss.links || []).forEach((link) => {
      if (!link?.key) return;
      if (!linkStubs.has(link.key)) linkStubs.set(link.key, stubFromLink(link));
    });
  });

  const resolve = (key) => byKey.get(key) || linkStubs.get(key) || null;
  return { byKey, resolve };
}

function resolveOrStub(key, resolve) {
  return (
    resolve(key) || {
      key,
      summary: key,
      project: projectOfKey(key),
      links: [],
      _stub: true,
      span: isHomeKey(key) ? 'ndb_ew' : 'nutanix_ew',
      spanInfo: {
        id: isHomeKey(key) ? 'ndb_ew' : 'nutanix_ew',
        short: isHomeKey(key) ? 'Peer NDB' : 'Nutanix',
        source: 'inferred_link_stub',
      },
    }
  );
}

/**
 * Build a wait tree: node → waitsOn: [child trees…].
 * Multiple children = one ticket waiting on several (fan-out).
 */
function buildWaitTree(node, resolve, depth, visited) {
  if (!node?.key) return null;
  if (depth >= MAX_DEPTH) {
    return {
      node: { key: '…', summary: 'continues', _truncated: true },
      waitsOn: [],
    };
  }
  if (visited.has(node.key)) {
    return { node, waitsOn: [] };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(node.key);
  const ups = upstreamKeysFromIssue(node).filter((k) => !nextVisited.has(k));
  const waitsOn = ups
    .map((k) => buildWaitTree(resolveOrStub(k, resolve), resolve, depth + 1, nextVisited))
    .filter(Boolean);
  return { node, waitsOn };
}

/**
 * Build trees for "We wait on them":
 * Project → waits on → [them, …] → each may wait on → [someone, …]
 */
function buildWeWaitTrees(blockers, projects, resolve) {
  const projectByKey = new Map();
  (projects || []).forEach((p) => {
    if (p?.key) projectByKey.set(p.key, p);
  });

  const projectToBlockers = new Map();

  const addPair = (projectKey, blockerKey) => {
    if (!projectKey || !blockerKey) return;
    if (!projectToBlockers.has(projectKey)) projectToBlockers.set(projectKey, new Set());
    projectToBlockers.get(projectKey).add(blockerKey);
  };

  (blockers || []).forEach((blocker) => {
    let paired = false;
    (blocker.links || []).forEach((link) => {
      if (!link?.key || !linkLooksLikeBlocks(link)) return;
      if (!isHomeKey(link.key, link.project)) return;
      addPair(link.key, blocker.key);
      paired = true;
      const fromLink = stubFromLink(link);
      const existing = projectByKey.get(link.key);
      const resolved = resolve(link.key);
      projectByKey.set(link.key, pickRicherIssue(pickRicherIssue(existing, fromLink), resolved));
    });
    (projects || []).forEach((proj) => {
      const hits = (proj.links || []).some(
        (l) => l.key === blocker.key && linkLooksLikeBlocks(l)
      );
      if (hits) {
        addPair(proj.key, blocker.key);
        paired = true;
        const resolved = resolve(proj.key);
        projectByKey.set(proj.key, pickRicherIssue(projectByKey.get(proj.key) || proj, resolved));
      }
    });
    if (!paired) {
      addPair(`_orphan_${blocker.key}`, blocker.key);
      projectByKey.set(`_orphan_${blocker.key}`, {
        key: `_orphan_${blocker.key}`,
        summary: 'Project link not in payload',
        orphan: true,
        links: [],
      });
    }
  });

  const out = [];

  projectToBlockers.forEach((blockerKeys, projectKey) => {
    const project = pickRicherIssue(projectByKey.get(projectKey), resolve(projectKey));
    if (!project) return;
    const visited = new Set([project.key]);
    // Fan-out: project waits on ALL direct blockers at once
    const waitsOn = [...blockerKeys]
      .map((bKey) => {
        const blocker = resolve(bKey);
        if (!blocker) return null;
        return buildWaitTree(blocker, resolve, 1, visited);
      })
      .filter(Boolean);

    out.push({
      project,
      tree: { node: project, waitsOn },
    });
  });

  return out.sort((a, b) =>
    String(a.project.summary || a.project.key).localeCompare(
      String(b.project.summary || b.project.key)
    )
  );
}

/**
 * They wait on us: Partner → waits on → [our tickets…] → each may wait on more.
 * Fan-out when one partner waits on multiple of ours.
 */
function buildTheyWaitTrees(q4Tickets, resolve, allIssues) {
  // partnerKey → Set of our ticket keys
  const partnerToOurs = new Map();

  const add = (partnerKey, ourKey) => {
    if (!partnerKey || !ourKey) return;
    if (!partnerToOurs.has(partnerKey)) partnerToOurs.set(partnerKey, new Set());
    partnerToOurs.get(partnerKey).add(ourKey);
  };

  (q4Tickets || []).forEach((ticket) => {
    const home = isHomeKey(ticket.key, ticket.project);

    if (!home) {
      let ourKeys = upstreamKeysFromIssue(ticket).filter((k) => isHomeKey(k));
      if (!ourKeys.length) ourKeys = allDependencyLinkKeys(ticket).filter((k) => isHomeKey(k));
      if (!ourKeys.length) {
        partnerToOurs.set(ticket.key, new Set());
        return;
      }
      ourKeys.forEach((ok) => add(ticket.key, ok));
      return;
    }

    let partnerKeys = downstreamKeysFromIssue(ticket);
    if (!partnerKeys.length) {
      partnerKeys = allDependencyLinkKeys(ticket).filter((k) => !isHomeKey(k));
    }
    if (!partnerKeys.length) partnerKeys = findWaitersOf(ticket.key, allIssues);
    if (!partnerKeys.length) {
      partnerKeys = allDependencyLinkKeys(ticket).filter((k) => k !== ticket.key);
    }
    if (!partnerKeys.length) {
      add(`_solo_${ticket.key}`, ticket.key);
      return;
    }
    partnerKeys.forEach((pKey) => add(pKey, ticket.key));
  });

  const out = [];
  partnerToOurs.forEach((ourKeys, partnerKey) => {
    const solo = String(partnerKey).startsWith('_solo_');
    const partner = solo
      ? {
          key: partnerKey.replace(/^_solo_/, ''),
          summary: resolve(partnerKey.replace(/^_solo_/, ''))?.summary || 'Our ticket',
          orphan: true,
          _solo: true,
        }
      : resolveOrStub(partnerKey, resolve);

    const visited = new Set([partner.key]);
    const waitsOn = [...ourKeys]
      .map((ok) => {
        const ours = resolveOrStub(ok, resolve);
        return buildWaitTree(ours, resolve, 1, visited);
      })
      .filter(Boolean);

    if (!waitsOn.length && !solo) {
      waitsOn.push({
        node: {
          key: `_need_home_${partnerKey}`,
          summary: 'Our NDB ticket not on this partner’s links',
          orphan: true,
        },
        waitsOn: [],
      });
    }

    out.push({
      project: partner,
      tree: { node: partner, waitsOn },
    });
  });

  return out.sort((a, b) =>
    String(a.project.summary || a.project.key).localeCompare(
      String(b.project.summary || b.project.key)
    )
  );
}

function statusOf(node) {
  return String(node?.status || node?.issue?.status || '').trim();
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('closed') || s.includes('done') || s.includes('resolved') || s.includes('complete')) {
    return 'done';
  }
  if (s.includes('block') || s.includes('imped')) return 'blocked';
  if (s.includes('progress') || s.includes('review') || s.includes('test') || s.includes('execute')) {
    return 'active';
  }
  if (s.includes('open') || s.includes('to do') || s.includes('backlog') || s.includes('new')) {
    return 'open';
  }
  return 'other';
}

function ProjectCard({ node, jiraBaseUrl }) {
  if (node?.orphan || String(node?.key || '').startsWith('_orphan_')) {
    return (
      <div className="dv-edge-project dv-edge-project--orphan">
        <span className="dv-edge-project-sum">{node.summary}</span>
      </div>
    );
  }
  const href = browseUrl(jiraBaseUrl, node.key);
  const fv = fixVersionLabel(node);
  const status = statusOf(node);
  const issueType = String(node.issueType || node?.issue?.issueType || '').trim();
  const dateMeta = targetDateMeta(node);
  return (
    <a
      className={`dv-edge-project${dateMeta?.overdue ? ' dv-edge-project--overdue' : ''}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={[
        node.summary,
        node.key,
        status ? `Status: ${status}` : '',
        issueType ? `Type: ${issueType}` : '',
        dateMeta ? dateMeta.text : '',
        dateMeta?.overdue
          ? 'OVERDUE — date/sprint ended and ticket is still open'
          : null,
        fv ? `fixVersion: ${fv}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
    >
      <span className="dv-edge-project-sum">{shortSummary(node.summary)}</span>
      <span className="dv-edge-project-meta">
        {status ? (
          <span className={`dv-status dv-status--${statusTone(status)}`}>{status}</span>
        ) : (
          <span className="dv-status dv-status--unknown">no status</span>
        )}
        {issueType ? <span className="dv-issuetype">{issueType}</span> : null}
        {dateMeta ? (
          <span
            className={`dv-date dv-date--${dateMeta.source}${
              dateMeta.inferred ? ' dv-date--inferred' : ''
            }${dateMeta.overdue ? ' dv-date--overdue' : ''}`}
          >
            {dateMeta.text}
          </span>
        ) : null}
        {fv ? <span className="dv-fv">fixVersion: {fv}</span> : null}
        <span className="dv-chip-key" aria-hidden="true">
          {node.key}
        </span>
      </span>
    </a>
  );
}

function ChainNode({ node, jiraBaseUrl, isRoot }) {
  if (!node) return null;
  if (node._truncated) {
    return <span className="dv-chain-truncated">{node.summary || '…'}</span>;
  }
  // Prefer full ticket chip when we have status or type (incl. hydrated link stubs)
  const hasIdentity =
    !node.orphan &&
    !String(node.key || '').startsWith('_orphan_') &&
    (Boolean(node.status) || Boolean(node.issueType) || !node._stub);

  let inner = null;
  if (hasIdentity) {
    inner = (
      <TicketChip
        issue={node}
        jiraBaseUrl={jiraBaseUrl}
        showAskFlags={!isRoot}
        emphasize={Boolean(isRoot && Array.isArray(node.ancestorChain) && node.ancestorChain.length > 1)}
      />
    );
  } else if (isRoot || node.orphan || String(node.key || '').startsWith('_orphan_')) {
    inner = <ProjectCard node={node} jiraBaseUrl={jiraBaseUrl} />;
  } else if (node._stub) {
    const status = statusOf(node);
    const issueType = String(node.issueType || '').trim();
    inner = (
      <a
        className="dv-chain-stub"
        href={browseUrl(jiraBaseUrl, node.key)}
        target="_blank"
        rel="noopener noreferrer"
        title={[
          node.summary,
          status ? `Status: ${status}` : '',
          issueType ? `Type: ${issueType}` : '',
        ]
          .filter(Boolean)
          .join('\n')}
      >
        <span className="dv-chip-sum">{shortSummary(node.summary, 48)}</span>
        <span className="dv-edge-project-meta">
          {status ? (
            <span className={`dv-status dv-status--${statusTone(status)}`}>{status}</span>
          ) : null}
          {issueType ? <span className="dv-issuetype">{issueType}</span> : null}
          <span className="dv-chip-key">{node.key}</span>
        </span>
      </a>
    );
  } else {
    inner = <TicketChip issue={node} jiraBaseUrl={jiraBaseUrl} />;
  }

  if (isRoot) return withHierarchy(node, jiraBaseUrl, inner);
  return inner;
}

function WaitArrow({ count }) {
  const multi = count > 1;
  return (
    <div className="dv-chain-arrow" aria-hidden="true">
      <span className="dv-edge-arrow-label">{multi ? `waits on ${count}` : 'waits on'}</span>
      <span className="dv-edge-arrow-line">→</span>
    </div>
  );
}

/**
 * Recursive fan-out: one node waiting on many children, each may wait on more.
 */
function WaitTreeView({ tree, jiraBaseUrl, mode, depth = 0 }) {
  if (!tree?.node) return null;
  const kids = tree.waitsOn || [];
  const isRoot = depth === 0;
  const hopLabel = (() => {
    if (mode === 'they') {
      if (depth === 0) return 'Partner';
      if (depth === 1) return 'Our ticket';
      return 'Ticket';
    }
    if (depth === 0) return 'Project';
    if (depth === 1) return 'Them';
    return 'Ticket';
  })();

  return (
    <div className={`dv-wait-tree dv-wait-tree--d${depth}`}>
      <div className="dv-chain-node">
        <span className="dv-chain-hop">{hopLabel}</span>
        <ChainNode node={tree.node} jiraBaseUrl={jiraBaseUrl} isRoot={isRoot} />
      </div>
      {kids.length > 0 ? (
        <>
          <WaitArrow count={kids.length} />
          <div
            className={`dv-wait-fan${kids.length > 1 ? ' dv-wait-fan--multi' : ''}`}
            aria-label={`Waits on ${kids.length} ticket${kids.length === 1 ? '' : 's'}`}
          >
            {kids.length > 1 ? (
              <span className="dv-wait-fan-label">
                waits on {kids.length} tickets
              </span>
            ) : null}
            <div className="dv-wait-fan-items">
              {kids.map((child) => (
                <div key={child.node.key} className="dv-wait-fan-item">
                  <WaitTreeView
                    tree={child}
                    jiraBaseUrl={jiraBaseUrl}
                    mode={mode}
                    depth={depth + 1}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ProjectWaitRow({ tree, jiraBaseUrl, mode }) {
  if (!tree) return null;
  return (
    <div className="dv-chain-row dv-chain-row--tree">
      <WaitTreeView tree={tree} jiraBaseUrl={jiraBaseUrl} mode={mode} depth={0} />
    </div>
  );
}

const EW_RANK = { global_ew: 3, nutanix_ew: 2, ndb_ew: 1, team_internal: 0 };

function laneForTree(tree, mode) {
  if (mode === 'they') {
    const partner = tree?.node;
    if (partner && !partner.orphan && !String(partner.key || '').startsWith('_')) {
      return spanIdOf(partner);
    }
  }
  // Widest EW among direct “waits on” children (fan-out)
  let best = 'team_internal';
  let bestRank = -1;
  (tree?.waitsOn || []).forEach((child) => {
    const id = spanIdOf(child.node);
    const r = EW_RANK[id] || 0;
    if (r > bestRank) {
      best = id;
      bestRank = r;
    }
  });
  return best;
}

function groupProjectTreesByEw(projectTrees, mode) {
  const map = Object.fromEntries(EW_LANES.map((l) => [l.id, []]));
  (projectTrees || []).forEach((row) => {
    const lane = laneForTree(row.tree, mode);
    const id = map[lane] ? lane : 'team_internal';
    map[id].push(row);
  });
  return map;
}

function EdgeLane({ lane, items, jiraBaseUrl, mode, emptyHint }) {
  if (!items.length) {
    return emptyHint ? (
      <div className={`dv-edge-lane dv-edge-lane--${lane.tone}`}>
        <p className="dv-empty">{emptyHint}</p>
      </div>
    ) : null;
  }
  return (
    <div className={`dv-edge-lane dv-edge-lane--${lane.tone}`}>
      <div className="dv-edge-lane-head">
        <span className="dv-edge-lane-title">{lane.title}</span>
        <span className="dv-edge-lane-hint">{lane.hint}</span>
        <span className="dv-edge-lane-count">
          {items.length} project{items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="dv-edge-lane-body">
        {items.map((item) => (
          <ProjectWaitRow
            key={item.project.key}
            tree={item.tree}
            jiraBaseUrl={jiraBaseUrl}
            mode={mode}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Who waits on whom — clear multi-hop chains:
 * Project → waits on → them → waits on → someone → …
 */
export default function DependencySwimlanes({
  iWaitIssues,
  theyWaitIssues,
  projectIssues,
  chainExtras,
  jiraBaseUrl,
  iWaitJiraUrl,
  iWaitJql,
  theyWaitJiraUrl,
  theyWaitJql,
  showIWait = true,
  showTheyWait = true,
}) {
  const model = useMemo(() => {
    const lists = [
      iWaitIssues || [],
      theyWaitIssues || [],
      projectIssues || [],
      chainExtras || [],
    ];
    const { resolve, byKey } = indexIssues(lists);
    const allIssues = [...byKey.values()];
    const we = buildWeWaitTrees(iWaitIssues, projectIssues, resolve);
    const they = buildTheyWaitTrees(theyWaitIssues, resolve, allIssues);
    return {
      we,
      they,
      weByEw: groupProjectTreesByEw(we, 'we'),
      theyByEw: groupProjectTreesByEw(they, 'they'),
      iCount: (iWaitIssues || []).length,
      theyCount: (theyWaitIssues || []).length,
    };
  }, [iWaitIssues, theyWaitIssues, projectIssues, chainExtras]);

  if (!showIWait && !showTheyWait) return null;

  return (
    <section className="dv-swimlanes" aria-label="Who waits on whom">
      <header className="dv-swim-head">
        <h2>Who waits on whom</h2>
        <p className="dv-swim-story">
          Read left → right. If one ticket waits on several, they stack under the same “waits on”
          arrow (up to {MAX_DEPTH} hops).
        </p>
        <p className="dv-swim-legend" aria-hidden="true">
          <strong>Project</strong>
          <span className="dv-edge-arrow-line">→ waits on (N) →</span>
          <strong>Them…</strong>
        </p>
      </header>

      {showIWait ? (
        <div className="dv-edge-section">
          <div className="dv-edge-section-head">
            <h3>We wait on them (and who they wait on)</h3>
            <span className="dv-meta">
              {iWaitJiraUrl ? (
                <a href={iWaitJiraUrl} target="_blank" rel="noopener noreferrer" title={iWaitJql || ''}>
                  {model.iCount} direct blockers
                </a>
              ) : (
                `${model.iCount} direct blockers`
              )}
            </span>
          </div>
          {!model.we.length ? (
            <p className="dv-empty" style={{ padding: '0.5rem 0.75rem' }}>
              No wait chains for the current filters.
            </p>
          ) : (
            EW_LANES.filter((l) => (model.weByEw[l.id] || []).length > 0).map((lane) => (
              <EdgeLane
                key={`we-${lane.id}`}
                lane={lane}
                items={model.weByEw[lane.id]}
                jiraBaseUrl={jiraBaseUrl}
                mode="we"
              />
            ))
          )}
        </div>
      ) : null}

      {showTheyWait ? (
        <div className="dv-edge-section">
          <div className="dv-edge-section-head">
            <h3>They wait on us (and who we wait on)</h3>
            <span className="dv-meta">
              {theyWaitJiraUrl ? (
                <a
                  href={theyWaitJiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={theyWaitJql || ''}
                >
                  {model.theyCount} tickets
                </a>
              ) : (
                `${model.theyCount} tickets`
              )}
            </span>
          </div>
          {!model.they.length ? (
            <p className="dv-empty" style={{ padding: '0.5rem 0.75rem' }}>
              No partner → us chains for the current filters.
            </p>
          ) : (
            EW_LANES.filter((l) => (model.theyByEw[l.id] || []).length > 0).map((lane) => (
              <EdgeLane
                key={`they-${lane.id}`}
                lane={lane}
                items={model.theyByEw[lane.id]}
                jiraBaseUrl={jiraBaseUrl}
                mode="they"
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
