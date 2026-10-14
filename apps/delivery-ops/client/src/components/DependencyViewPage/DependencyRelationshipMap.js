import React, { useMemo } from 'react';
import {
  filterPartnersOfRelated,
  filterRelatedWishlist,
  meaningfulLinks,
} from './wishlistRelated';

const W = 1200;
const H = 520;
const PAD = { left: 56, right: 28, top: 28, bottom: 44 };
const MAX_NODES = 48;
const GAP = 8;

function browseUrl(jiraBaseUrl, key) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${base}/browse/${key}`;
}

function truncate(s, n = 16) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function statusParticipation(status) {
  const s = String(status || '').toLowerCase();
  if (['closed', 'done', 'complete', 'resolved'].some((x) => s.includes(x))) return 9;
  if (s.includes('progress') || s.includes('review') || s.includes('testing')) return 7;
  if (s.includes('open') || s.includes('to do') || s.includes('backlog')) return 3;
  if (s.includes('block')) return 5;
  return 5;
}

function typeImpact(issueType) {
  const t = String(issueType || '').toUpperCase();
  if (t.includes('X-FEAT') || t.includes('CAPABILITY')) return 5;
  if (t.includes('FEATURE') || t.includes('INITIATIVE')) return 4;
  if (t.includes('EPIC')) return 3;
  if (t.includes('BUG')) return 2.5;
  return 2;
}

/**
 * Relationship subgraph only — no label-only / Clone-only wishlist, no orphan dump.
 */
function collectNodes(filtered, ignoredLinkTypePatterns) {
  const byKey = new Map();

  const add = (issue, role) => {
    if (!issue?.key) return;
    const prev = byKey.get(issue.key);
    if (!prev) {
      byKey.set(issue.key, { ...issue, role, roles: new Set([role]) });
      return;
    }
    prev.roles.add(role);
    const rank = { wishlist: 2, upstream: 2, downstream: 2, partner: 1 };
    if ((rank[role] || 0) > (rank[prev.role] || 0)) prev.role = role;
    const nextLinks = meaningfulLinks(issue, ignoredLinkTypePatterns);
    if (nextLinks.length > meaningfulLinks(prev, ignoredLinkTypePatterns).length) {
      prev.links = issue.links;
    }
  };

  const related = filterRelatedWishlist(
    filtered?.wishlist,
    filtered?.wishlistUnlinked,
    ignoredLinkTypePatterns
  );
  const partners = filterPartnersOfRelated(
    related,
    filtered?.wishlistLinked || [],
    ignoredLinkTypePatterns
  );
  related.forEach((i) => add(i, 'wishlist'));
  partners.forEach((i) => add(i, 'partner'));
  (filtered?.partnershipBlockedBy || []).forEach((i) => add(i, 'upstream'));
  (filtered?.partnershipBlocks || []).forEach((i) => add(i, 'downstream'));

  return [...byKey.values()].slice(0, MAX_NODES);
}

/**
 * X: readiness (−5 risk/unlinked → +5 committed/linked)
 * Y: participation (status activity 0–10)
 * Size: impact (issue type + link degree)
 */
function scoreNode(node) {
  const linkCount = (node.links || []).length;
  let x = 0; // -5 .. +5
  if (node.role === 'orphan' || node.role === 'unlinked') x = -4;
  else if (node.commitState === 'ask') x = -1;
  else if (node.commitState === 'committed') x = 3.5;
  else x = 0;

  if (node.role === 'partner' && node.commitState !== 'committed') x = Math.max(x, 1);
  if (node.role === 'partner' && node.commitState === 'committed') x = 4.5;
  if (linkCount > 0 && x < 0) x += 1.5; // linked softens risk
  if (linkCount === 0 && (node.role === 'wishlist' || node.role === 'partner')) x -= 1;

  x = Math.max(-5, Math.min(5, x));

  let y = statusParticipation(node.status);
  y += Math.min(2, linkCount * 0.4);
  y = Math.max(0, Math.min(10, y));

  const size = typeImpact(node.issueType) + Math.min(3, linkCount * 0.5);

  return { x, y, size };
}

function hash01(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Fan out nodes that share the same score bucket so they don't stack on one pixel */
function fanOutScores(scored) {
  const buckets = new Map();
  scored.forEach((s) => {
    const key = `${Math.round(s.x * 2) / 2}|${Math.round(s.y)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  });
  buckets.forEach((arr) => {
    if (arr.length <= 1) return;
    arr.forEach((s, i) => {
      const angle = (2 * Math.PI * i) / arr.length + hash01(s.node.key) * 0.4;
      const rad = 0.55 + 0.22 * Math.floor(i / 6);
      s.x = Math.max(-5, Math.min(5, s.x + Math.cos(angle) * rad));
      s.y = Math.max(0, Math.min(10, s.y + Math.sin(angle) * rad * 1.35));
    });
  });
  return scored;
}

function toCanvas(x, y, size, key) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const jx = (hash01(`${key}:x`) - 0.5) * 0.35;
  const jy = (hash01(`${key}:y`) - 0.5) * 0.45;
  const cx = PAD.left + ((x + jx + 5) / 10) * plotW;
  const cy = PAD.top + (1 - (y + jy) / 10) * plotH;
  // Smaller bubbles so more fit without crushing
  const r = Math.min(26, 10 + size * 2.2);
  return { cx, cy, r };
}

function clampPlot(p) {
  p.cx = Math.max(PAD.left + p.r, Math.min(W - PAD.right - p.r, p.cx));
  p.cy = Math.max(PAD.top + p.r, Math.min(H - PAD.bottom - p.r, p.cy));
}

/** Stronger collision resolve + soft center bias so plot stays readable */
function nudge(positions) {
  const out = positions.map((p) => ({ ...p }));
  const midX = (PAD.left + W - PAD.right) / 2;
  const midY = (PAD.top + H - PAD.bottom) / 2;

  for (let iter = 0; iter < 48; iter += 1) {
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i];
        const b = out[j];
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          // identical coords — shove apart on a deterministic angle
          const ang = hash01(`${a.node.key}|${b.node.key}`) * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          dist = 0.01;
        }
        const minDist = a.r + b.r + GAP;
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.55;
          dx *= push;
          dy *= push;
          a.cx -= dx;
          a.cy -= dy;
          b.cx += dx;
          b.cy += dy;
        }
      }
    }
    // Soft pull back toward score anchors every few iters (keeps axis meaning)
    if (iter % 6 === 5) {
      out.forEach((p) => {
        p.cx += (p.anchorCx - p.cx) * 0.08;
        p.cy += (p.anchorCy - p.cy) * 0.08;
        // tiny outward breath so clusters don't collapse to mid
        p.cx += (p.cx - midX) * 0.01;
        p.cy += (p.cy - midY) * 0.01;
        clampPlot(p);
      });
    } else {
      out.forEach(clampPlot);
    }
  }
  out.forEach(clampPlot);
  return out;
}

function roleFill(role) {
  switch (role) {
    case 'orphan':
      return '#ae3ec9';
    case 'unlinked':
      return '#e67700';
    case 'wishlist':
      return '#1c7ed6';
    case 'upstream':
      return '#e8590c';
    case 'downstream':
      return '#0b7285';
    case 'partner':
    default:
      return '#2f9e44';
  }
}

export default function DependencyRelationshipMap({
  filtered,
  jiraBaseUrl,
  release,
  ignoredLinkTypePatterns,
}) {
  const { nodes, edges, axis } = useMemo(() => {
    const collected = collectNodes(filtered, ignoredLinkTypePatterns);
    const scored = fanOutScores(
      collected.map((node) => ({ node, ...scoreNode(node) }))
    );
    const placed = scored.map((s) => {
      const pos = toCanvas(s.x, s.y, s.size, s.node.key);
      return {
        ...s,
        ...pos,
        anchorCx: pos.cx,
        anchorCy: pos.cy,
      };
    });
    const nudged = nudge(placed);

    const byKey = new Map(nudged.map((n) => [n.node.key, n]));
    const edgeList = [];
    const seen = new Set();
    nudged.forEach((n) => {
      meaningfulLinks(n.node, ignoredLinkTypePatterns).forEach((link) => {
        const other = byKey.get(link.key);
        if (!other) return;
        // outward: this → other; inward: other → this (opposite arrow)
        const from = link.direction === 'inward' ? other : n;
        const to = link.direction === 'inward' ? n : other;
        const direction = link.direction === 'inward' ? 'inward' : 'outward';
        const id = `${from.node.key}->${to.node.key}`;
        if (seen.has(id)) return;
        seen.add(id);
        edgeList.push({ from, to, type: link.type || 'link', direction });
      });
    });

    return {
      nodes: nudged,
      edges: edgeList,
      axis: {
        xMin: -5,
        xMax: 5,
        yMin: 0,
        yMax: 10,
      },
    };
  }, [filtered, ignoredLinkTypePatterns]);

  if (!nodes.length) {
    return <div className="dv-empty">No issues for relationship map.</div>;
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const zeroX = PAD.left + ((0 - axis.xMin) / (axis.xMax - axis.xMin)) * plotW;

  return (
    <div className="dv-relmap">
      <div className="dv-relmap-head">
        <span className="dv-relmap-title">
          Relationship mapping{release ? ` · ${release}` : ''}
        </span>
        <span className="dv-meta">
          X = readiness (risk → committed) · Y = participation · size = impact · lines = links
        </span>
      </div>
      <svg
        className="dv-relmap-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Dependency relationship scatter map"
      >
        <defs>
          <marker
            id="dv-rel-arrow-out"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#c92a2a" />
          </marker>
          <marker
            id="dv-rel-arrow-in"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#e67700" />
          </marker>
        </defs>

        {/* plot background */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          className="dv-relmap-plot"
        />

        {/* quadrant hint */}
        <line
          x1={zeroX}
          y1={PAD.top}
          x2={zeroX}
          y2={H - PAD.bottom}
          className="dv-relmap-axis-mid"
        />

        {/* axes */}
        <line
          x1={PAD.left}
          y1={H - PAD.bottom}
          x2={W - PAD.right}
          y2={H - PAD.bottom}
          className="dv-relmap-axis"
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={H - PAD.bottom}
          className="dv-relmap-axis"
        />

        <text x={PAD.left} y={H - 12} className="dv-relmap-axis-label">
          Against / at risk
        </text>
        <text
          x={W - PAD.right}
          y={H - 12}
          textAnchor="end"
          className="dv-relmap-axis-label"
        >
          For / committed
        </text>
        <text
          x={14}
          y={H / 2}
          transform={`rotate(-90 14 ${H / 2})`}
          textAnchor="middle"
          className="dv-relmap-axis-label"
        >
          Participation
        </text>
        <text x={PAD.left + 4} y={PAD.top + 12} className="dv-relmap-axis-hint">
          High
        </text>
        <text x={PAD.left + 4} y={H - PAD.bottom - 6} className="dv-relmap-axis-hint">
          Low
        </text>

        {/* edges under nodes */}
        {edges.map((e) => {
          const dx = e.to.cx - e.from.cx;
          const dy = e.to.cy - e.from.cy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const sx = e.from.cx + (dx / len) * e.from.r;
          const sy = e.from.cy + (dy / len) * e.from.r;
          const ex = e.to.cx - (dx / len) * (e.to.r + 4);
          const ey = e.to.cy - (dy / len) * (e.to.r + 4);
          const inward = e.direction === 'inward';
          return (
            <line
              key={`${e.from.node.key}-${e.to.node.key}`}
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              className={inward ? 'dv-relmap-edge dv-relmap-edge--in' : 'dv-relmap-edge dv-relmap-edge--out'}
              markerEnd={inward ? 'url(#dv-rel-arrow-in)' : 'url(#dv-rel-arrow-out)'}
            >
              <title>
                {`${inward ? 'Inward' : 'Outward'}: ${e.from.node.key} → ${e.to.node.key} (${e.type})`}
              </title>
            </line>
          );
        })}

        {nodes.map((n) => (
          <a
            key={n.node.key}
            href={browseUrl(jiraBaseUrl, n.node.key)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <g className="dv-relmap-node">
              <circle
                cx={n.cx}
                cy={n.cy}
                r={n.r}
                fill={roleFill(n.node.role)}
                fillOpacity={0.85}
                stroke="#fff"
                strokeWidth={2}
              />
              <text
                x={n.cx}
                y={n.cy - 2}
                textAnchor="middle"
                className="dv-relmap-node-key"
              >
                {n.node.key}
              </text>
              <text
                x={n.cx}
                y={n.cy + 10}
                textAnchor="middle"
                className="dv-relmap-node-sum"
              >
                {truncate(n.node.summary, Math.max(8, Math.floor(n.r / 2)))}
              </text>
              <title>
                {`${n.node.key}: ${n.node.summary}\n${n.node.role} · ${n.node.commitState || ''} · links ${(n.node.links || []).length}\nX=${n.x.toFixed(1)} Y=${n.y.toFixed(1)}`}
              </title>
            </g>
          </a>
        ))}
      </svg>
      <div className="dv-meta dv-relmap-foot">
        Size of circle ≈ extent of impact (issue type + link degree). {nodes.length} nodes
        {nodes.length >= MAX_NODES ? ` (capped at ${MAX_NODES})` : ''}.
      </div>
    </div>
  );
}
