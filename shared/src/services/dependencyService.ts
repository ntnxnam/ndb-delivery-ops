/**
 * dependencyService — cross-team dependency graph (per D18).
 *
 * Phase D1 ships `upstreamOf` working off JIRA `is blocked by` links.
 * Phase D2 adds:
 *   - downstreamOf
 *   - teamGraph (aggregated by team via component → team mapping)
 *   - criticalPath
 *   - untrackedSuggestions (Confluence + Slack scan)
 *
 * Cross-references:
 *   - DECISIONS.md → D18
 *   - .cursor/skills/dependency-walk/SKILL.md
 *   - .cursor/agents/specialists/dependency-tracker-specialist.md
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { ProductService } from './productService.js';
import type { Citation } from '../types/release.js';

export interface DependencyServiceOptions {
  jira: JiraConnector;
  products: ProductService;
}

export interface DepGraphNode {
  key: string;
  summary: string;
  status: string;
  team?: string;
  release?: string;
  crossRelease?: boolean;
}

export interface DepGraphEdge {
  from: string;
  to: string;
  linkType: string;
  inferred: boolean;
  sourceLink?: string;
  crossRelease?: boolean;
}

export interface DepGraph {
  startKey: string;
  direction: 'upstream' | 'downstream';
  nodes: DepGraphNode[];
  edges: DepGraphEdge[];
  teams: string[];
  maxDepth: number;
  actualDepth: number;
  truncated: boolean;
  cycles: Array<{ from: string; to: string }>;
  inferredCount: number;
  refreshedAt: string;
  citations: Citation[];
}

export class DependencyService {
  private jira: JiraConnector;
  // Reserved for Phase D2 — team-graph + critical-path will use productService.
  // private products: ProductService;

  constructor(opts: DependencyServiceOptions) {
    this.jira = opts.jira;
    // this.products = opts.products;
  }

  /**
   * Walk upstream from `startKey` following `is blocked by` links.
   */
  async upstreamOf(startKey: string, maxDepth = 5): Promise<DepGraph> {
    return this.walk(startKey, 'upstream', maxDepth);
  }

  /**
   * Walk downstream from `startKey` following `blocks` links.
   */
  async downstreamOf(startKey: string, maxDepth = 5): Promise<DepGraph> {
    return this.walk(startKey, 'downstream', maxDepth);
  }

  /**
   * Phase D2 stub: team-aggregated dependency graph for a release.
   */
  async teamGraph(
    _productId: string,
    _releaseName: string
  ): Promise<{ nodes: string[]; edges: Array<{ from: string; to: string; weight: number }>; citations: Citation[] }> {
    return {
      nodes: [],
      edges: [],
      citations: [
        {
          kind: 'data-source',
          label: 'dependencyService.teamGraph (Phase D2 stub)',
          reference: 'not-implemented',
        },
      ],
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async walk(
    startKey: string,
    direction: 'upstream' | 'downstream',
    maxDepth: number
  ): Promise<DepGraph> {
    const visited = new Set<string>();
    const nodes: Map<string, DepGraphNode> = new Map();
    const edges: DepGraphEdge[] = [];
    const cycles: Array<{ from: string; to: string }> = [];
    const teams = new Set<string>();
    let actualDepth = 0;

    // BFS frontier
    let frontier: Array<{ key: string; depth: number }> = [{ key: startKey, depth: 0 }];
    while (frontier.length) {
      const next: Array<{ key: string; depth: number }> = [];
      for (const { key, depth } of frontier) {
        if (visited.has(key)) {
          // Treat any re-visit during BFS as a cycle indicator.
          cycles.push({ from: 'visited', to: key });
          continue;
        }
        visited.add(key);
        actualDepth = Math.max(actualDepth, depth);

        const issue = await this.jira.getIssue(key, [
          'summary',
          'status',
          'issuelinks',
          'components',
          'fixVersions',
        ]);
        const fld = issue.fields ?? {};
        const summary = String(fld.summary ?? '');
        const status = (fld.status as { name?: string } | undefined)?.name ?? '';
        const components = (fld.components as Array<{ name: string }> | undefined) ?? [];
        const release = ((fld.fixVersions as Array<{ name: string }> | undefined) ?? [])[0]?.name;
        const team = components[0]?.name;
        if (team) teams.add(team);
        nodes.set(key, { key, summary, status, team, release });

        if (depth >= maxDepth) continue;

        // Find the right link direction.
        const issuelinks = ((fld.issuelinks as Array<unknown> | undefined) ?? []) as Array<{
          id: string;
          type: { name: string; inward: string; outward: string };
          inwardIssue?: { key: string };
          outwardIssue?: { key: string };
        }>;
        for (const link of issuelinks) {
          let nextKey: string | undefined;
          let linkType = '';
          if (direction === 'upstream' && link.inwardIssue && link.type.inward === 'is blocked by') {
            nextKey = link.inwardIssue.key;
            linkType = 'is blocked by';
          } else if (
            direction === 'downstream' &&
            link.outwardIssue &&
            link.type.outward === 'blocks'
          ) {
            nextKey = link.outwardIssue.key;
            linkType = 'blocks';
          }
          if (!nextKey) continue;
          edges.push({
            from: key,
            to: nextKey,
            linkType,
            inferred: false,
            sourceLink: `issuelink#${link.id}`,
          });
          if (!visited.has(nextKey)) {
            next.push({ key: nextKey, depth: depth + 1 });
          }
        }
      }
      frontier = next;
    }

    const truncated = actualDepth >= maxDepth && frontier.length > 0;
    return {
      startKey,
      direction,
      nodes: [...nodes.values()],
      edges,
      teams: [...teams],
      maxDepth,
      actualDepth,
      truncated,
      cycles,
      inferredCount: 0,
      refreshedAt: new Date().toISOString(),
      citations: [
        { kind: 'data-source', label: `dependencyService.${direction}Of(${startKey})`, reference: startKey },
      ],
    };
  }
}
