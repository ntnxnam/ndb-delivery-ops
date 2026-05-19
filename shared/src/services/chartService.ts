/**
 * chartService — Phase D2 stub (per D4).
 *
 * The full implementation will produce SVG (and optional PNG) charts for
 * inline use in agent answers, reports, and emails. For Phase D1 it
 * returns a placeholder ChartRef so the VP path can render end-to-end.
 *
 * Anticipated chart kinds (per D4 + DECISIONS.md):
 *   - rag-over-time
 *   - landing-date-confidence
 *   - risk-burndown
 *   - top-risks-by-owner
 *   - predictability-say-vs-do
 *   - scope-creep
 *   - team-velocity
 *   - sprint-carryover
 *
 * Cross-references:
 *   - DECISIONS.md → D4
 *   - .cursor/agents/specialists/vp-specialist.md (consumer)
 */

import type { ChartSpec, ChartRef } from '../types/chart.js';

export class ChartService {
  /**
   * Phase D1 placeholder. Phase D2 will use a real SVG generator (likely
   * d3 or a hand-rolled minimal SVG builder for embed safety).
   */
  async render(spec: ChartSpec): Promise<ChartRef> {
    const svg = this.placeholderSvg(spec);
    return {
      spec,
      svg,
      caption: `[chartService.${spec.kind} — Phase D1 placeholder] ${spec.title}`,
    };
  }

  private placeholderSvg(spec: ChartSpec): string {
    const width = spec.width ?? 400;
    const height = spec.height ?? 200;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `  <rect width="${width}" height="${height}" fill="#f5f5f5" stroke="#ccc"/>`,
      `  <text x="${width / 2}" y="${height / 2}" font-family="system-ui" font-size="14" fill="#555" text-anchor="middle">`,
      `    [chart placeholder: ${escapeXml(spec.title)} (${spec.kind})]`,
      `  </text>`,
      `</svg>`,
    ].join('\n');
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (ch) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]!)
  );
}
